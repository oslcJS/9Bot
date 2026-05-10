"""spin_on_hit.py - Example NB Module
Makes the bot spin around aggressively when hit.
Toggleable: set ACTIVE = False to disable without unloading.
Retrainable: uses simple RL to optimize spin duration and direction.

Import NB (ninebot/9Bot module API):
  from NB import log, get_state, set_control, on, off, toggle, is_active, train, save_model, load_model
"""

from NB import log, get_state, set_control, on, off, toggle, is_active, train, save_model, load_model
import random
import math

MODULE_NAME = "spin_on_hit"
ACTIVE = True

SPIN_DURATION = 1.2
SPIN_SPEED = 1.0
SPIN_DIRECTION = "right"
CRITICAL_HEALTH_THRESHOLD = 6.0

Q_TABLE = {}

def _get_q(state_key, action):
    return Q_TABLE.get((state_key, action), 0.0)

def _update_q(state_key, action, reward, next_state_key):
    lr = 0.1
    discount = 0.9
    old_q = _get_q(state_key, action)
    future_q = max([_get_q(next_state_key, a) for a in ["left", "right", "fast_left", "fast_right"]], default=0.0)
    Q_TABLE[(state_key, action)] = old_q + lr * (reward + discount * future_q - old_q)

def _spin_behavior(data):
    if not ACTIVE:
        return
    if not is_active():
        return

    state = get_state()
    health = state.get("health", 20.0)
    attacker_pos = data.get("attacker_position", {})
    my_pos = state.get("position", {})

    dist = 999
    if attacker_pos and my_pos:
        dx = attacker_pos.get("x", 0) - my_pos.get("x", 0)
        dz = attacker_pos.get("z", 0) - my_pos.get("z", 0)
        dist = math.sqrt(dx*dx + dz*dz)

    health_key = "low" if health < CRITICAL_HEALTH_THRESHOLD else "high"
    dist_key = "close" if dist < 3 else "far"
    state_key = f"{health_key}_{dist_key}"

    global SPIN_DIRECTION, SPIN_DURATION, SPIN_SPEED

    q_left = _get_q(state_key, "left")
    q_right = _get_q(state_key, "right")
    q_fast_left = _get_q(state_key, "fast_left")
    q_fast_right = _get_q(state_key, "fast_right")

    best_action = max([
        ("left", q_left),
        ("right", q_right),
        ("fast_left", q_fast_left),
        ("fast_right", q_fast_right)
    ], key=lambda x: x[1])[0]

    if best_action == "left":
        SPIN_DIRECTION = "left"
        SPIN_SPEED = 0.8
        SPIN_DURATION = 1.0
    elif best_action == "right":
        SPIN_DIRECTION = "right"
        SPIN_SPEED = 0.8
        SPIN_DURATION = 1.0
    elif best_action == "fast_left":
        SPIN_DIRECTION = "left"
        SPIN_SPEED = 1.5
        SPIN_DURATION = 1.5
    elif best_action == "fast_right":
        SPIN_DIRECTION = "right"
        SPIN_SPEED = 1.5
        SPIN_DURATION = 1.5

    set_control("sprint", True)
    set_control("forward", True)
    set_control("jump", True)
    if SPIN_DIRECTION == "right":
        set_control("right", True)
        set_control("left", False)
    else:
        set_control("left", True)
        set_control("right", False)

    log(f"SPINNING {SPIN_DIRECTION} | health={health} dist={dist:.1f} action={best_action}")

    import time
    time.sleep(SPIN_DURATION * 0.3)

    set_control("right", False)
    set_control("left", False)
    set_control("forward", False)
    set_control("jump", False)

    new_state = get_state()
    new_health = new_state.get("health", health)
    reward = (health - new_health) * -5
    if new_health > health:
        reward += 10
    if dist < 2:
        reward += 5

    next_health_key = "low" if new_health < CRITICAL_HEALTH_THRESHOLD else "high"
    next_state_key = f"{next_health_key}_{dist_key}"
    _update_q(state_key, best_action, reward, next_state_key)

def on_hit(data):
    _spin_behavior(data)

def init():
    log(f"{MODULE_NAME} loaded | active={is_active()}")
    on("hit", on_hit)

def retrain(generations=20):
    log(f"Retraining {MODULE_NAME} for {generations} generations...")
    for gen in range(generations):
        simulated_state_keys = [
            "low_close", "low_far", "high_close", "high_far"
        ]
        for sk in simulated_state_keys:
            for action in ["left", "right", "fast_left", "fast_right"]:
                noise = random.uniform(-0.05, 0.15)
                _update_q(sk, action, noise, sk)
        if gen % 5 == 0:
            log(f"  retrain gen {gen}/{generations}")
    log(f"Retrain complete. Q-table size: {len(Q_TABLE)}")
    return {"status": "ok", "q_size": len(Q_TABLE)}

def unload():
    off("hit", on_hit)
    log(f"{MODULE_NAME} unloaded")

init()
