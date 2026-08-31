from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


AGENT_VERSION = "1.0.0"
DEFAULT_STATE_DIR = Path(".video-processor")
STOP = threading.Event()


def log(message: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def require_binary(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(f"'{name}' was not found in PATH")


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


class DurableState:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.session_file = self.root / "session.json"
        self.active_file = self.root / "active-job.json"

    def load(self, path: Path) -> dict[str, Any] | None:
        try:
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None

    def instance_id(self) -> str:
        session = self.load(self.session_file) or {}
        if session.get("instance_id"):
            return str(session["instance_id"])
        value = str(uuid.uuid4())
        atomic_json(self.session_file, {**session, "instance_id": value})
        return value

    def save_session(self, value: dict[str, Any]) -> None:
        current = self.load(self.session_file) or {}
        atomic_json(self.session_file, {**current, **value})

    def active(self) -> dict[str, Any] | None:
        return self.load(self.active_file)

    def save_active(self, value: dict[str, Any]) -> None:
        atomic_json(self.active_file, value)

    def clear_active(self) -> None:
        self.active_file.unlink(missing_ok=True)

    def job_dir(self, job_id: str) -> Path:
        path = self.root / "jobs" / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class OrchestratorClient:
    def __init__(self, base_url: str, shared_secret: str):
        self.base_url = base_url.rstrip("/")
        self.shared_secret = shared_secret
        self.worker_id = ""
        self.worker_token = ""
        self.session = requests.Session()

    def headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.shared_secret}",
            "Content-Type": "application/json",
            "User-Agent": f"video-processor/{AGENT_VERSION}",
        }
        if self.worker_token:
            headers["X-Worker-Token"] = self.worker_token
        return headers

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self.session.request(
            method,
            f"{self.base_url}{path}",
            headers=self.headers(),
            json=body,
            timeout=(15, 120),
        )
        try:
            payload = response.json()
        except ValueError:
            payload = {"error": response.text[:500] or f"HTTP {response.status_code}"}
        if not response.ok:
            raise ApiError(response.status_code, str(payload.get("message") or payload.get("error")))
        return payload

    def register(self, instance_id: str) -> dict[str, Any]:
        name = socket.gethostname()
        data = self.request("POST", "/v1/workers/register", {
            "instance_id": instance_id,
            "display_name": name,
            "hostname": socket.gethostname(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "agent_version": AGENT_VERSION,
            "capabilities": {"ffmpeg": True, "two_pass_x264": True},
            "metadata": {},
        })
        self.worker_id = str(data["worker_id"])
        self.worker_token = str(data["worker_token"])
        return data

    def claim(self) -> dict[str, Any]:
        return self.request("POST", "/v1/jobs/claim", {"worker_id": self.worker_id})

    def heartbeat(self, job: dict[str, Any], progress: float, current_pass: str | None, state: str):
        return self.request("POST", f"/v1/jobs/{job['id']}/heartbeat", {
            "worker_id": self.worker_id,
            "claim_token": job["claim_token"],
            "progress": round(progress, 2),
            "current_pass": current_pass,
            "state": state,
        })

    def complete(self, job: dict[str, Any]):
        return self.request("POST", f"/v1/jobs/{job['id']}/complete", {
            "worker_id": self.worker_id,
            "claim_token": job["claim_token"],
        })

    def transfer(self, job: dict[str, Any]):
        return self.request("POST", f"/v1/jobs/{job['id']}/transfer", {
            "worker_id": self.worker_id,
            "claim_token": job["claim_token"],
        })

    def fail(self, job: dict[str, Any], code: str, message: str, retryable: bool = True):
        return self.request("POST", f"/v1/jobs/{job['id']}/fail", {
            "worker_id": self.worker_id,
            "claim_token": job["claim_token"],
            "error_code": code,
            "error_message": message[:2000],
            "retryable": retryable,
        })


@dataclass
class ProgressState:
    value: float = 0.0
    current_pass: str | None = None
    stage: str = "claimed"


class LeaseKeeper(threading.Thread):
    def __init__(self, client: OrchestratorClient, job: dict[str, Any], progress: ProgressState, interval: int):
        super().__init__(daemon=True)
        self.client = client
        self.job = job
        self.progress = progress
        self.interval = max(10, interval)
        self.stop = threading.Event()
        self.claim_lost = threading.Event()
        self.lost_status = 409
        self.latest_config: dict[str, Any] | None = None

    def run(self):
        while not self.stop.wait(self.interval) and not STOP.is_set():
            try:
                response = self.client.heartbeat(
                    self.job,
                    self.progress.value,
                    self.progress.current_pass,
                    self.progress.stage,
                )
                self.latest_config = response.get("config")
            except ApiError as error:
                if error.status in (401, 409):
                    self.lost_status = error.status
                    self.claim_lost.set()
                    return
                log(f"Heartbeat failed transiently: {error}")
            except requests.RequestException as error:
                log(f"Heartbeat network error: {error}")


def duration_seconds(input_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def parse_ffmpeg_time(line: str) -> float | None:
    if "time=" not in line:
        return None
    try:
        value = line.split("time=", 1)[1].split(" ", 1)[0]
        if value == "N/A":
            return None
        hours, minutes, seconds = value.split(":")
        return float(hours) * 3600 + float(minutes) * 60 + float(seconds)
    except (ValueError, IndexError):
        return None


def calculate_video_bitrate_kbps(
    target_size_mb: int,
    duration: float,
    audio_kbps: int,
    minimum_video_kbps: int,
) -> int:
    total_bitrate_kbps = (target_size_mb * 8192) / max(duration, 1.0)
    return max(minimum_video_kbps, int(total_bitrate_kbps - audio_kbps))


def run_pass(command: list[str], duration: float, progress: ProgressState, start: float, span: float, lease: LeaseKeeper) -> None:
    process = subprocess.Popen(
        command,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    try:
        while True:
            if STOP.is_set():
                process.kill()
                raise RuntimeError("Processing stopped")
            if lease.claim_lost.is_set():
                process.kill()
                raise ApiError(lease.lost_status, "job_lease_lost")
            line = process.stderr.readline() if process.stderr else ""
            if not line and process.poll() is not None:
                break
            current = parse_ffmpeg_time(line)
            if current is not None:
                progress.value = min(start + span, start + (current / max(duration, 1.0)) * span)
        code = process.wait()
        if code != 0:
            raise RuntimeError(f"FFmpeg exited with code {code}")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def compress_exact(input_path: Path, output_path: Path, job_dir: Path, settings: dict[str, Any], progress: ProgressState, lease: LeaseKeeper) -> None:
    duration = duration_seconds(input_path)
    if duration <= 0:
        raise RuntimeError("ffprobe returned an invalid duration")

    max_res = int(settings["max_resolution"])
    target_size_mb = int(settings["target_size_mb"])
    preset = str(settings["ffmpeg_preset"])
    audio_kbps = int(settings["audio_bitrate_kbps"])
    minimum_video_kbps = int(settings.get("minimum_video_bitrate_kbps", 200))
    video_bitrate_kbps = calculate_video_bitrate_kbps(
        target_size_mb, duration, audio_kbps, minimum_video_kbps
    )
    passlog = (job_dir / "ffmpeg-pass").as_posix()
    temporary_output = job_dir / "encoded.temp.mp4"
    null_output = "NUL" if os.name == "nt" else "/dev/null"

    progress.stage = "processing"
    progress.current_pass = "P1"
    run_pass([
        "ffmpeg", "-y", "-i", str(input_path), "-vf", f"scale=-2:{max_res}",
        "-c:v", "libx264", "-b:v", f"{video_bitrate_kbps}k", "-pass", "1",
        "-passlogfile", passlog, "-preset", preset, "-an", "-f", "mp4", null_output,
    ], duration, progress, 0, 50, lease)

    progress.current_pass = "P2"
    run_pass([
        "ffmpeg", "-y", "-i", str(input_path), "-vf", f"scale=-2:{max_res}",
        "-c:v", "libx264", "-b:v", f"{video_bitrate_kbps}k", "-pass", "2",
        "-passlogfile", passlog, "-preset", preset,
        "-maxrate", f"{video_bitrate_kbps}k", "-bufsize", f"{video_bitrate_kbps * 2}k",
        "-c:a", "aac", "-b:a", f"{audio_kbps}k", str(temporary_output),
    ], duration, progress, 50, 50, lease)

    if not temporary_output.exists() or temporary_output.stat().st_size <= 0:
        raise RuntimeError("FFmpeg did not produce a valid output file")
    os.replace(temporary_output, output_path)
    for item in job_dir.glob("ffmpeg-pass*"):
        item.unlink(missing_ok=True)


def download(job: dict[str, Any], destination: Path, lease: LeaseKeeper) -> None:
    partial = destination.with_suffix(destination.suffix + ".part")
    existing = partial.stat().st_size if partial.exists() else 0
    expected_size = int(job["source_size"])
    # A crash can happen after the final fsync and before the atomic rename.
    # Promote a complete part directly instead of issuing an invalid range.
    if existing == expected_size:
        os.replace(partial, destination)
        return
    if existing > expected_size:
        partial.unlink(missing_ok=True)
        existing = 0
    headers = {"Range": f"bytes={existing}-"} if existing else {}
    with requests.get(job["download_url"], headers=headers, stream=True, timeout=(20, 900)) as response:
        # Signed object stores may answer a stale range with 416. If the part
        # is not complete, discard it and restart from byte zero safely.
        if existing and response.status_code == 416:
            response.close()
            partial.unlink(missing_ok=True)
            return download(job, destination, lease)
        if existing and response.status_code == 200:
            existing = 0
        response.raise_for_status()
        mode = "ab" if existing and response.status_code == 206 else "wb"
        with partial.open(mode) as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if STOP.is_set():
                    raise RuntimeError("Download stopped")
                if lease.claim_lost.is_set():
                    raise ApiError(lease.lost_status, "job_lease_lost")
                if chunk:
                    handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
    if partial.stat().st_size != expected_size:
        raise RuntimeError("Downloaded size does not match the claimed object")
    os.replace(partial, destination)


class LeaseAwareReader:
    def __init__(self, handle, lease: LeaseKeeper):
        self.handle = handle
        self.lease = lease

    def __len__(self) -> int:
        return os.fstat(self.handle.fileno()).st_size

    def read(self, size: int = -1) -> bytes:
        if STOP.is_set():
            raise RuntimeError("Upload stopped")
        if self.lease.claim_lost.is_set():
            raise ApiError(self.lease.lost_status, "job_lease_lost")
        return self.handle.read(size)

    def __getattr__(self, name: str):
        return getattr(self.handle, name)


def upload(job: dict[str, Any], source: Path, lease: LeaseKeeper) -> None:
    with source.open("rb") as handle:
        response = requests.put(
            job["upload_url"],
            data=LeaseAwareReader(handle, lease),
            headers={
                "Content-Type": job.get("upload_content_type", "video/mp4"),
                "Content-Length": str(source.stat().st_size),
            },
            timeout=(20, 900),
        )
    response.raise_for_status()


def process_job(client: OrchestratorClient, state: DurableState, active: dict[str, Any], config: dict[str, Any]) -> None:
    job = active["job"]
    job_dir = state.job_dir(job["id"])
    input_path = job_dir / str(job["source_name"])
    output_path = job_dir / str(job["output_name"])
    heartbeat_interval = int(config["runtime"]["heartbeat_interval_seconds"])
    progress = ProgressState(
        value=float(active.get("progress", 0)),
        current_pass=active.get("current_pass"),
        stage=str(active.get("stage", "claimed")),
    )
    lease = LeaseKeeper(client, job, progress, heartbeat_interval)

    try:
        client.heartbeat(job, progress.value, progress.current_pass, progress.stage)
        job.update(client.transfer(job))
        state.save_active({**active, "job": job})
        lease.start()
        if not input_path.exists() and not output_path.exists():
            log(f"Downloading {job['source_name']}")
            download(job, input_path, lease)
            state.save_active({**active, "stage": "claimed"})

        if not output_path.exists():
            log(f"Compressing {job['source_name']} with settings version {config['version']}")
            compress_exact(input_path, output_path, job_dir, job["settings"], progress, lease)
            state.save_active({**active, "stage": "uploading", "progress": progress.value})

        if lease.claim_lost.is_set():
            raise ApiError(409, "claim_lost")
        progress.stage = "uploading"
        progress.current_pass = None
        client.heartbeat(job, progress.value, None, "uploading")
        job.update(client.transfer(job))
        state.save_active({**active, "job": job, "stage": "uploading", "progress": progress.value})
        log(f"Uploading {job['output_name']}")
        upload(job, output_path, lease)
        client.complete(job)
        log(f"Completed {job['source_name']}")
        shutil.rmtree(job_dir, ignore_errors=True)
        state.clear_active()
    finally:
        lease.stop.set()
        if lease.is_alive():
            lease.join(timeout=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Durable video compression processor")
    parser.add_argument("--orchestrator-url", default=os.environ.get("ORCHESTRATOR_URL"))
    parser.add_argument("--secret", default=os.environ.get("WORKER_SHARED_SECRET"))
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--max-runtime", type=int, default=0, help="Maximum runtime in seconds; 0 is unlimited")
    parser.add_argument("--exit-when-idle", type=int, default=0, help="Exit after this many idle seconds")
    args = parser.parse_args()
    if not args.orchestrator_url or not args.secret:
        parser.error("ORCHESTRATOR_URL and WORKER_SHARED_SECRET are required")

    require_binary("ffmpeg")
    require_binary("ffprobe")
    state = DurableState(args.state_dir)
    client = OrchestratorClient(args.orchestrator_url, args.secret)
    instance_id = state.instance_id()
    registration = client.register(instance_id)
    state.save_session({
        "instance_id": instance_id,
        "worker_id": client.worker_id,
        "worker_token": client.worker_token,
    })
    config = registration["config"]
    started = time.monotonic()
    idle_since: float | None = None

    while not STOP.is_set():
        if args.max_runtime and time.monotonic() - started >= args.max_runtime:
            log("Maximum runtime reached")
            break
        active = state.active()
        if not active:
            response = client.claim()
            config = response.get("config", config)
            job = response.get("job")
            if not job:
                idle_since = idle_since or time.monotonic()
                if args.once or (args.exit_when_idle and time.monotonic() - idle_since >= args.exit_when_idle):
                    break
                STOP.wait(int(config["runtime"].get("idle_poll_seconds", 15)))
                continue
            idle_since = None
            active = {"job": job, "stage": "claimed", "progress": 0, "config_version": config["version"]}
            state.save_active(active)

        try:
            process_job(client, state, active, config)
        except ApiError as error:
            if error.status == 401:
                log("Worker session expired; registering again")
                try:
                    registration = client.register(instance_id)
                    config = registration["config"]
                    state.save_session({
                        "instance_id": instance_id,
                        "worker_id": client.worker_id,
                        "worker_token": client.worker_token,
                    })
                except Exception as registration_error:
                    log(f"Worker registration failed: {registration_error}")
                    STOP.wait(15)
                continue
            if error.status == 409:
                log(f"Job ownership ended: {error}")
                state.clear_active()
                continue
            log(f"API error: {error}")
            STOP.wait(10)
        except Exception as error:
            log(f"Job failed: {error}")
            try:
                client.fail(active["job"], "processor_error", str(error), retryable=True)
                state.clear_active()
            except Exception as report_error:
                log(f"Failure report could not be delivered; checkpoint retained: {report_error}")
            STOP.wait(5)

    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        STOP.set()
        raise SystemExit(130)
