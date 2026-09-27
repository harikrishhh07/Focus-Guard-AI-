#!/usr/bin/env python3
"""
FocusGuard AI — Real-time Vision Attention & Smart Gadget Distraction Tracker
=============================================================================
Combines OpenCV, DeepFace, and Ultralytics YOLO to track:
  1. Session Gating: ONLY analyzes and logs when a Focus Session is ACTIVE.
  2. Smart Gadget Detection: Uses YOLO to detect physical smartphones (cell phones)
     in the user's hand or frame.
  3. Head & Gaze Pose (Pitch / Yaw): Detects when user tilts head down towards lap/desk.
  4. Cognitive Fatigue & Absence: DeepFace emotion & face presence validation.

Usage:
  python vision_tracker.py              # Opens HUD preview window
  python vision_tracker.py --headless   # Runs silently in background
  python vision_tracker.py --no-sound   # Disables audio alert chime
"""

import sys
import os
import time
import math
import argparse
import threading
import logging
from datetime import datetime, timezone
from pathlib import Path

# Disable TensorFlow verbose logs before importing DeepFace
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import requests
try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False
    cv2 = None
    np = None

# Try importing winsound for gentle audio warnings on Windows
try:
    import winsound
    HAS_WINSOUND = True
except ImportError:
    HAS_WINSOUND = False

# Try importing DeepFace
try:
    from deepface import DeepFace
    HAS_DEEPFACE = True
except Exception:
    HAS_DEEPFACE = False

# Try importing YOLO for Smartphone & Gadget detection
try:
    from ultralytics import YOLO
    HAS_YOLO = True
except Exception:
    HAS_YOLO = False

# ─── Load Environment Configuration ─────────────────────────────────────────
ENV_PATH = Path(__file__).parent / '.env'
if ENV_PATH.exists():
    from decouple import Config, RepositoryEnv
    _config = Config(RepositoryEnv(str(ENV_PATH)))
else:
    from decouple import config as _config

API_BASE    = _config('AGENT_API_BASE', default='http://127.0.0.1:8000/api')
USERNAME    = _config('AGENT_USERNAME',  default='admin')
PASSWORD    = _config('AGENT_PASSWORD',  default='admin123')
CAMERA_IDX  = int(_config('VISION_CAMERA_INDEX', default='0'))
POST_SECS   = float(_config('VISION_POST_INTERVAL', default='3.0'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [VISION] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('focusguard-vision')


# ─── Backend API Client ─────────────────────────────────────────────────────
class VisionAPIClient:
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip('/')
        self.username = username
        self.password = password
        self.token = None
        self.session = requests.Session()

    def authenticate(self) -> bool:
        try:
            r = self.session.post(
                f'{self.base_url}/auth/token/',
                json={'username': self.username, 'password': self.password},
                timeout=8
            )
            if r.status_code == 200:
                data = r.json()
                self.token = data.get('access') or data.get('tokens', {}).get('access')
                self.session.headers.update({'Authorization': f'Bearer {self.token}'})
                log.info(f'Authenticated with backend as user "{self.username}"')
                return True
            log.warning(f'Login failed ({r.status_code}): {r.text[:100]}')
        except Exception as e:
            log.warning(f'Connection failed to {self.base_url}: {e}')
        return False

    def is_session_active(self) -> bool:
        try:
            r = self.session.get(f'{self.base_url}/dashboard/summary/', timeout=4)
            if r.status_code == 401:
                self.authenticate()
                r = self.session.get(f'{self.base_url}/dashboard/summary/', timeout=4)
            if r.status_code == 200:
                data = r.json()
                return bool(data.get('is_session_active') or data.get('active_focus_session'))
        except Exception:
            pass
        return False

    def post_attention_log(self, payload: dict) -> bool:
        try:
            r = self.session.post(f'{self.base_url}/system/attention/', json=payload, timeout=6)
            if r.status_code == 401:
                self.authenticate()
                r = self.session.post(f'{self.base_url}/system/attention/', json=payload, timeout=6)
            return r.status_code in (200, 201)
        except Exception as e:
            log.debug(f'post_attention error: {e}')
            return False


# ─── Vision & Head-Pose & Gadget Estimator ──────────────────────────────────
class AttentionEstimator:
    def __init__(self):
        # Load OpenCV Haar Cascades for face and eye detection
        self.face_cascade = None
        self.profile_cascade = None
        self.eye_cascade = None
        if hasattr(cv2, 'CascadeClassifier') and hasattr(cv2, 'data'):
            try:
                self.face_cascade = cv2.CascadeClassifier(
                    cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
                )
                self.profile_cascade = cv2.CascadeClassifier(
                    cv2.data.haarcascades + 'haarcascade_profileface.xml'
                )
                self.eye_cascade = cv2.CascadeClassifier(
                    cv2.data.haarcascades + 'haarcascade_eye.xml'
                )
            except Exception as e:
                log.warning(f"Could not load cv2 cascades: {e}")

        # Initialize YOLO for Smartphone & Gadget Detection (COCO class 67 is 'cell phone')
        self.yolo_model = None
        if HAS_YOLO:
            try:
                log.info('Loading YOLOv8 nano model for physical smartphone & gadget detection...')
                self.yolo_model = YOLO('yolov8n.pt')
                log.info('YOLOv8 nano model ready! Smartphone detection active.')
            except Exception as e:
                log.warning(f'Could not load YOLO model: {e}')
                self.yolo_model = None

        self.last_deepface_check = 0.0
        self.cached_emotion = 'neutral'
        self.deepface_busy = False

        self.last_yolo_check = 0.0
        self.cached_gadget_detected = False
        self.cached_gadget_boxes = []
        self.yolo_busy = False

    def async_deepface_analyze(self, face_roi):
        """Asynchronously runs DeepFace emotion detection to prevent GUI frame drop."""
        if not HAS_DEEPFACE or self.deepface_busy:
            return

        def _worker():
            self.deepface_busy = True
            try:
                res = DeepFace.analyze(
                    img_path=face_roi,
                    actions=['emotion'],
                    enforce_detection=False,
                    silent=True
                )
                if isinstance(res, list) and len(res) > 0:
                    self.cached_emotion = res[0].get('dominant_emotion', 'neutral')
                elif isinstance(res, dict):
                    self.cached_emotion = res.get('dominant_emotion', 'neutral')
            except Exception:
                pass
            finally:
                self.deepface_busy = False

        threading.Thread(target=_worker, daemon=True).start()

    def async_detect_gadgets(self, frame_copy):
        """Runs YOLO smartphone/gadget detector asynchronously."""
        if not self.yolo_model or self.yolo_busy:
            return

        def _worker():
            self.yolo_busy = True
            try:
                # Class 67 in COCO is 'cell phone'
                results = self.yolo_model.predict(
                    frame_copy,
                    classes=[67],
                    conf=0.35,
                    verbose=False
                )
                boxes = []
                for r in results:
                    for b in r.boxes:
                        coords = b.xyxy[0].cpu().numpy().astype(int)
                        boxes.append((coords[0], coords[1], coords[2] - coords[0], coords[3] - coords[1]))

                self.cached_gadget_boxes = boxes
                self.cached_gadget_detected = len(boxes) > 0
            except Exception:
                pass
            finally:
                self.yolo_busy = False

        threading.Thread(target=_worker, daemon=True).start()

    def process_frame(self, frame):
        """
        Processes a single BGR frame.
        Returns:
            dict containing:
              - state: 'FOCUSED' | 'LOOKING_AT_PHONE' | 'LOOKING_AWAY' | 'USER_ABSENT'
              - pitch: estimated vertical tilt angle
              - yaw: estimated horizontal turn angle
              - attention_score: 0-100
              - face_box: (x, y, w, h) or None
              - emotion: current detected emotion
              - gadget_detected: bool
              - gadget_boxes: list of (x, y, w, h)
        """
        h_frame, w_frame = frame.shape[:2]
        now = time.time()

        # Trigger YOLO phone detection every 0.8 seconds
        if self.yolo_model and (now - self.last_yolo_check > 0.8):
            self.last_yolo_check = now
            self.async_detect_gadgets(frame.copy())

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)

        # Detect frontal faces
        faces = self.face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.15,
            minNeighbors=5,
            minSize=(80, 80)
        )

        # If no frontal face detected, check profile face (user turned head sideways)
        if len(faces) == 0:
            profiles = self.profile_cascade.detectMultiScale(
                gray,
                scaleFactor=1.15,
                minNeighbors=4,
                minSize=(80, 80)
            )
            if len(profiles) > 0:
                px, py, pw, ph = max(profiles, key=lambda b: b[2] * b[3])
                return {
                    'state': 'LOOKING_AWAY',
                    'pitch': 0.0,
                    'yaw': 35.0,
                    'roll': 0.0,
                    'attention_score': 20.0,
                    'face_box': (px, py, pw, ph),
                    'face_detected': True,
                    'emotion': self.cached_emotion,
                    'gadget_detected': self.cached_gadget_detected,
                    'gadget_boxes': self.cached_gadget_boxes,
                }
            # No face at all
            return {
                'state': 'USER_ABSENT',
                'pitch': 0.0,
                'yaw': 0.0,
                'roll': 0.0,
                'attention_score': 0.0,
                'face_box': None,
                'face_detected': False,
                'emotion': '',
                'gadget_detected': self.cached_gadget_detected,
                'gadget_boxes': self.cached_gadget_boxes,
            }

        # Pick largest face
        x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
        face_roi_gray = gray[y:y+h, x:x+w]
        face_roi_color = frame[y:y+h, x:x+w]

        # Trigger DeepFace emotion check every 6 seconds
        if now - self.last_deepface_check > 6.0:
            self.last_deepface_check = now
            self.async_deepface_analyze(face_roi_color)

        # Detect eyes inside face
        eyes = self.eye_cascade.detectMultiScale(
            face_roi_gray,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(20, 20)
        )

        pitch = 0.0
        yaw = 0.0

        if len(eyes) >= 1:
            eyes_sorted = sorted(eyes, key=lambda e: e[0])
            avg_eye_y = sum(e[1] + e[3] / 2.0 for e in eyes) / len(eyes)
            eye_ratio_y = avg_eye_y / float(h)
            pitch = (0.36 - eye_ratio_y) * 100.0  # negative when tilted downwards

            if len(eyes) >= 2:
                e1, e2 = eyes_sorted[0], eyes_sorted[-1]
                eye_center_x = (e1[0] + e2[0] + e2[2]) / 2.0
                face_center_x = w / 2.0
                yaw = ((eye_center_x - face_center_x) / float(w)) * 80.0

        face_center_frame_y = (y + h / 2.0) / float(h_frame)
        if face_center_frame_y > 0.68:
            pitch -= 8.0

        # Classification heuristics:
        # 1. PHYSICAL GADGET DETECTED: If a phone object is visible in frame, flag immediately!
        # 2. POSTURAL DISTRACTION: Head tilted down (pitch < -11 deg)
        # 3. LOOKING AWAY: Head turned sideways (|yaw| > 22 deg)
        if self.cached_gadget_detected:
            state = 'LOOKING_AT_PHONE'
            attention_score = 15.0
        elif pitch < -11.0:
            state = 'LOOKING_AT_PHONE'
            attention_score = max(5.0, 45.0 + pitch)
        elif abs(yaw) > 22.0:
            state = 'LOOKING_AWAY'
            attention_score = max(10.0, 50.0 - abs(yaw))
        else:
            state = 'FOCUSED'
            attention_score = min(100.0, max(75.0, 100.0 - abs(pitch) * 1.5 - abs(yaw) * 1.2))

        return {
            'state': state,
            'pitch': round(pitch, 1),
            'yaw': round(yaw, 1),
            'roll': 0.0,
            'attention_score': round(attention_score, 1),
            'face_box': (x, y, w, h),
            'face_detected': True,
            'emotion': self.cached_emotion,
            'gadget_detected': self.cached_gadget_detected,
            'gadget_boxes': self.cached_gadget_boxes,
        }


# ─── Main Tracker Loop ───────────────────────────────────────────────────────
def run_vision_tracker(headless: bool = False, sound_enabled: bool = True):
    if not HAS_CV2:
        log.warning('OpenCV (cv2) is not installed. Vision tracker disabled.')
        return

    log.info('═' * 60)
    log.info(' FocusGuard AI — Vision Attention & Phone Distraction Tracker')
    log.info('═' * 60)
    log.info(f'  Backend API       : {API_BASE}')
    log.info(f'  User              : {USERNAME}')
    log.info(f'  Camera Index      : {CAMERA_IDX}')
    log.info(f'  DeepFace Emotion  : {"Active" if HAS_DEEPFACE else "Not Installed (Using Haar)"}')
    log.info(f'  YOLO Smartphone   : {"Active (COCO cell phone detection)" if HAS_YOLO else "Not Installed (Using Pose)"}')
    log.info(f'  Session Gated     : Active (Only tracks when Focus Session is started)')
    log.info(f'  Mode              : {"Headless Background" if headless else "HUD Preview Window"}')
    log.info('─' * 60)

    # Single-instance lock
    import socket
    lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        lock_socket.bind(('127.0.0.1', 49555))
        lock_socket.listen(1)
    except socket.error:
        log.warning('Another instance of Vision Tracker is already running. Exiting duplicate.')
        return

    client = VisionAPIClient(API_BASE, USERNAME, PASSWORD)
    if not client.authenticate():
        log.warning('Could not log in to backend. Telemetry will retry automatically.')

    estimator = AttentionEstimator()

    # Camera hardware starts CLOSED for privacy.
    # Only opened when a Focus Session is started!
    cap = None

    last_post_time = time.time()
    last_sound_time = 0.0
    last_session_check = 0.0
    session_active = False

    state_start_time = time.time()
    current_state = 'FOCUSED'
    recent_states = []

    log.info('[CAMERA] Vision Tracker on standby. Camera hardware is OFF.')
    log.info('         Start a Focus Session in the Web App to activate camera tracking.')

    try:
        while True:
            now = time.time()

            # Poll focus session status every 1.5 seconds
            if now - last_session_check >= 1.5:
                last_session_check = now
                new_active = client.is_session_active()
                if new_active != session_active:
                    session_active = new_active
                    if session_active:
                        log.info('[FOCUS] Focus session STARTED! Opening camera hardware & activating tracking.')
                    else:
                        log.info('[FOCUS] Focus session IDLE / STOPPED. Releasing camera hardware.')
                        if cap is not None:
                            cap.release()
                            cap = None
                        if not headless:
                            cv2.destroyAllWindows()

            # ─── CASE 1: FOCUS SESSION IS NOT ACTIVE (CAMERA HARDWARE OFF) ───
            if not session_active:
                if cap is not None:
                    cap.release()
                    cap = None
                    if not headless:
                        cv2.destroyAllWindows()
                time.sleep(1.0)
                continue

            # ─── CASE 2: FOCUS SESSION IS ACTIVE (OPEN CAMERA & ANALYZE) ───
            if cap is None:
                cap = cv2.VideoCapture(CAMERA_IDX)
                if not cap.isOpened():
                    log.error(f'Cannot open camera index {CAMERA_IDX}. Retrying in 2s...')
                    cap = None
                    time.sleep(2.0)
                    continue
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                log.info('[CAMERA] Camera hardware active and running at 640x480.')

            ret, frame = cap.read()
            if not ret:
                time.sleep(0.05)
                continue


            # ─── CASE 2: FOCUS SESSION IS ACTIVE (RUNNING ANALYSIS) ──────
            metrics = estimator.process_frame(frame)
            raw_state = metrics['state']

            recent_states.append(raw_state)
            if len(recent_states) > 5:
                recent_states.pop(0)

            majority_state = max(set(recent_states), key=recent_states.count)

            if majority_state != current_state:
                current_state = majority_state
                state_start_time = now

            duration_in_state = max(1, int(now - state_start_time))

            # Distraction Alert: Beep if user is looking at phone for > 4s
            if sound_enabled and HAS_WINSOUND and current_state == 'LOOKING_AT_PHONE':
                if duration_in_state >= 4 and (now - last_sound_time > 8.0):
                    last_sound_time = now
                    try:
                        winsound.Beep(750, 180)
                    except Exception:
                        pass

            # Post telemetry every POST_SECS
            if now - last_post_time >= POST_SECS:
                last_post_time = now
                payload = {
                    'state': current_state,
                    'pitch': metrics['pitch'],
                    'yaw': metrics['yaw'],
                    'roll': metrics['roll'],
                    'attention_score': metrics['attention_score'],
                    'duration_secs': int(POST_SECS),
                    'face_detected': metrics['face_detected'],
                    'emotion': metrics.get('emotion', ''),
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                }
                client.post_attention_log(payload)

            # GUI Preview Window
            if not headless:
                if current_state == 'FOCUSED':
                    color = (0, 220, 100)      # Green
                    badge = 'FOCUSED (SCREEN)'
                elif current_state == 'LOOKING_AT_PHONE':
                    color = (0, 140, 255)      # Orange
                    badge = 'PHONE DISTRACTION DETECTED'
                elif current_state == 'LOOKING_AWAY':
                    color = (0, 70, 255)       # Red-Orange
                    badge = 'LOOKING AWAY'
                else:
                    color = (160, 160, 160)    # Gray
                    badge = 'USER ABSENT'

                # Draw face box
                box = metrics['face_box']
                if box:
                    bx, by, bw, bh = box
                    cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), color, 2)
                    cv2.line(frame, (bx, by), (bx + 20, by), color, 4)
                    cv2.line(frame, (bx, by), (bx, by + 20), color, 4)
                    cv2.line(frame, (bx + bw, by + bh), (bx + bw - 20, by + bh), color, 4)
                    cv2.line(frame, (bx + bw, by + bh), (bx + bw, by + bh - 20), color, 4)

                # Draw Smartphone / Gadget bounding boxes (from YOLO)
                for gx, gy, gw, gh in metrics.get('gadget_boxes', []):
                    cv2.rectangle(frame, (gx, gy), (gx + gw, gy + gh), (0, 140, 255), 2)
                    cv2.rectangle(frame, (gx, max(0, gy - 24)), (gx + 160, gy), (0, 140, 255), -1)
                    cv2.putText(frame, "SMARTPHONE", (gx + 6, max(14, gy - 7)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

                # Overlay HUD panel
                overlay = frame.copy()
                cv2.rectangle(overlay, (15, 15), (460, 130), (20, 20, 25), -1)
                cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

                cv2.putText(frame, "FocusGuard AI -- Focus Session Active", (30, 42),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
                cv2.putText(frame, badge, (30, 72),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2, cv2.LINE_AA)

                gadget_note = " | Phone: DETECTED" if metrics.get('gadget_detected') else ""
                sub_text = (
                    f"Score: {metrics['attention_score']:.0f}% | "
                    f"Pitch: {metrics['pitch']:.0f}* | "
                    f"Mood: {metrics.get('emotion') or 'neutral'}{gadget_note}"
                )
                cv2.putText(frame, sub_text, (30, 102),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.40, (200, 200, 200), 1, cv2.LINE_AA)

                cv2.putText(frame, "Press 'q' to close preview", (15, frame.shape[0] - 15),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.42, (150, 150, 150), 1, cv2.LINE_AA)

                cv2.imshow('FocusGuard AI -- Attention Tracker', frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('s'):
                    sound_enabled = not sound_enabled
                    log.info(f'Audio alerts toggled: {"ON" if sound_enabled else "OFF"}')

    except KeyboardInterrupt:
        log.info('Stopping vision tracker...')
    finally:
        cap.release()
        if not headless:
            cv2.destroyAllWindows()
        log.info('Vision tracker stopped cleanly.')


# ─── CLI Entrypoint ──────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='FocusGuard AI Vision Attention Tracker')
    parser.add_argument('--headless', action='store_true', help='Run in background without GUI window')
    parser.add_argument('--no-sound', action='store_true', help='Disable gentle audio chime on distraction')
    args = parser.parse_args()

    run_vision_tracker(headless=args.headless, sound_enabled=not args.no_sound)
