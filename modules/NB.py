"""NB - NineBot Module API
Import this from your Python modules to interact with the bot.
Usage: from NB import log, get_state, set_control, on_hit, on_tick, active, toggle

Communication happens via JSON lines over stdin/stdout.
"""

import sys
import json
import threading
from enum import Enum

_bot_state = {}
_listeners = {}
_module_active = True
_module_name = "unknown"
_state_lock = threading.Lock()
_response_event = threading.Event()
_pending_responses = {}
_response_lock = threading.Lock()
_response_counter = 0

class Control(Enum):
    FORWARD = "forward"
    BACK = "back"
    LEFT = "left"
    RIGHT = "right"
    JUMP = "jump"
    SPRINT = "sprint"
    SNEAK = "sneak"
    ATTACK = "attack"

def _recv_loop():
    global _bot_state
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            msg_type = msg.get("type", "")
            if msg_type == "state":
                with _state_lock:
                    _bot_state = msg.get("data", {})
                _response_event.set()
            elif msg_type == "response":
                rid = msg.get("id")
                with _response_lock:
                    if rid in _pending_responses:
                        _pending_responses[rid]["result"] = msg.get("result")
                        _pending_responses[rid]["event"].set()
            elif msg_type == "event":
                evt = msg.get("event", "")
                evt_data = msg.get("data", {})
                with _state_lock:
                    _listeners_copy = dict(_listeners)
                if evt in _listeners_copy:
                    for cb in _listeners_copy[evt]:
                        try:
                            cb(evt_data)
                        except Exception as e:
                            _send_log(f"Module error in {evt}: {e}")
            elif msg_type == "error":
                _send_log(f"Bridge error: {msg.get('message', '')}")
        except json.JSONDecodeError:
            pass

def _send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def _send_log(msg):
    _send({"type": "log", "module": _module_name, "message": str(msg)})

def _send_control(control, value):
    _send({"type": "control", "module": _module_name, "control": control, "value": value})

def _send_command(cmd, args=None):
    _send({"type": "command", "module": _module_name, "command": cmd, "args": args or {}})

def _send_request(method, params=None):
    global _response_counter
    _response_counter += 1
    rid = _response_counter
    event = threading.Event()
    with _response_lock:
        _pending_responses[rid] = {"event": event, "result": None}
    _send({"type": "request", "id": rid, "method": method, "params": params or {}})
    event.wait(timeout=5.0)
    with _response_lock:
        result = _pending_responses.pop(rid, {}).get("result")
    return result

_listener_thread = threading.Thread(target=_recv_loop, daemon=True)
_listener_thread.start()

def init(name="module"):
    global _module_name
    _module_name = name
    _send({"type": "init", "module": name})

def log(message):
    _send_log(str(message))

def get_state():
    with _state_lock:
        return dict(_bot_state)

def get(key, default=None):
    with _state_lock:
        return _bot_state.get(key, default)

def set_control(control, value):
    if isinstance(control, Control):
        control = control.value
    _send_control(control, bool(value))

def set_movement(forward=0.0, strafe=0.0, jump=False, sprint=False, sneak=False):
    _send_command("set_movement", {
        "forward": float(forward),
        "strafe": float(strafe),
        "jump": bool(jump),
        "sprint": bool(sprint),
        "sneak": bool(sneak)
    })

def look_at(x, y, z):
    _send_command("look_at", {"x": float(x), "y": float(y), "z": float(z)})

def chat(message):
    _send_command("chat", {"message": str(message)})

def attack():
    _send_control("attack", True)

def spin(duration=1.0, direction="right"):
    _send_command("spin", {"duration": float(duration), "direction": direction})

def on(event, callback):
    with _state_lock:
        if event not in _listeners:
            _listeners[event] = []
        _listeners[event].append(callback)

def off(event, callback=None):
    with _state_lock:
        if callback is None:
            _listeners.pop(event, None)
        elif event in _listeners:
            _listeners[event] = [cb for cb in _listeners[event] if cb is not callback]

def toggle(state=None):
    global _module_active
    if state is not None:
        _module_active = bool(state)
    else:
        _module_active = not _module_active
    _send_command("set_active", {"active": _module_active})
    return _module_active

def is_active():
    return _module_active

def set_state(key, value):
    _send_command("set_state", {"key": key, "value": value})

def get_model_path(name="default"):
    return _send_request("get_model_path", {"name": name})

def save_model(data, name="default"):
    return _send_request("save_model", {"data": data, "name": name})

def load_model(name="default"):
    return _send_request("load_model", {"name": name})

def train(hyperparams=None):
    return _send_request("train_module", {
        "module": _module_name,
        "hyperparams": hyperparams or {}
    })

def wait_for_state(timeout=1.0):
    _response_event.clear()
    _response_event.wait(timeout=timeout)
    return get_state()
