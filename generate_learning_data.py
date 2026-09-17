"""Generate deterministic Gridworld learning traces for lecture animations.

The implementation deliberately uses only the Python standard library.  It
supports REINFORCE with a learned state-value baseline, one-step tabular
actor--critic, and tabular PPO-Clip with GAE.  Rendering is kept separate so
the algorithms remain easy to read and test.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import random
from pathlib import Path


ROWS = 5
COLS = 5
START = (4, 0)
GOAL = (0, 4)
WALLS = {(1, 2), (2, 2), (3, 2)}
ACTIONS = ((-1, 0), (0, 1), (1, 0), (0, -1))
ACTION_NAMES = ("up", "right", "down", "left")
MAX_STEPS = 35
GAMMA = 0.98
PPO_GAE_LAMBDA = 0.95
PPO_CLIP_EPSILON = 0.20
PPO_BATCH_EPISODES = 8
PPO_UPDATE_EPOCHS = 6
PPO_MINIBATCH_SIZE = 64
PPO_POLICY_RATE = 0.80
PPO_VALUE_RATE = 1.00
PPO_ENTROPY_COEFFICIENT = 0.01


def state_index(state: tuple[int, int]) -> int:
    return state[0] * COLS + state[1]


def softmax(logits: list[float]) -> list[float]:
    offset = max(logits)
    weights = [math.exp(value - offset) for value in logits]
    total = sum(weights)
    return [weight / total for weight in weights]


def sample_action(probabilities: list[float], rng: random.Random) -> int:
    threshold = rng.random()
    cumulative = 0.0
    for action, probability in enumerate(probabilities):
        cumulative += probability
        if threshold <= cumulative:
            return action
    return len(probabilities) - 1


def transition(
    state: tuple[int, int], action: int
) -> tuple[tuple[int, int], float, bool]:
    row_delta, col_delta = ACTIONS[action]
    candidate = (state[0] + row_delta, state[1] + col_delta)
    inside = 0 <= candidate[0] < ROWS and 0 <= candidate[1] < COLS
    next_state = candidate if inside and candidate not in WALLS else state
    terminal = next_state == GOAL
    reward = 1.0 if terminal else -0.03
    return next_state, reward, terminal


def policy_step(
    theta: list[list[float]],
    state: tuple[int, int],
    action: int,
    scale: float,
) -> None:
    index = state_index(state)
    probabilities = softmax(theta[index])
    for candidate in range(len(ACTIONS)):
        score = (1.0 if candidate == action else 0.0) - probabilities[candidate]
        theta[index][candidate] += scale * score
        theta[index][candidate] = max(-12.0, min(12.0, theta[index][candidate]))


def flat_values(values: list[float]) -> list[float]:
    return [round(value, 6) for value in values]


def ppo_update(
    theta: list[list[float]],
    values: list[float],
    samples: list[tuple[int, int, float, float, float]],
    rng: random.Random,
) -> None:
    """Run clipped PPO epochs on fixed old-policy rollout samples.

    Each sample contains state index, action, old log probability, GAE
    advantage, and critic target.  The old-policy quantities stay fixed across
    all epochs, while the current tabular softmax policy is updated by
    minibatch gradient ascent.
    """

    if not samples:
        return

    advantages = [sample[3] for sample in samples]
    advantage_mean = sum(advantages) / len(advantages)
    advantage_variance = sum(
        (advantage - advantage_mean) ** 2 for advantage in advantages
    ) / len(advantages)
    advantage_scale = math.sqrt(advantage_variance + 1e-8)
    normalized_samples = [
        (state, action, old_log_probability,
         (advantage - advantage_mean) / advantage_scale, target)
        for state, action, old_log_probability, advantage, target in samples
    ]

    indices = list(range(len(normalized_samples)))
    state_count = len(values)
    action_count = len(ACTIONS)

    for _ in range(PPO_UPDATE_EPOCHS):
        rng.shuffle(indices)
        for start in range(0, len(indices), PPO_MINIBATCH_SIZE):
            minibatch = indices[start:start + PPO_MINIBATCH_SIZE]
            policy_gradient = [
                [0.0 for _ in range(action_count)]
                for _ in range(state_count)
            ]
            value_gradient = [0.0 for _ in range(state_count)]

            for sample_index in minibatch:
                (
                    state,
                    action,
                    old_log_probability,
                    advantage,
                    target,
                ) = normalized_samples[sample_index]
                probabilities = softmax(theta[state])
                action_probability = max(probabilities[action], 1e-12)
                ratio = math.exp(math.log(action_probability) - old_log_probability)
                clipped_ratio = max(
                    1.0 - PPO_CLIP_EPSILON,
                    min(1.0 + PPO_CLIP_EPSILON, ratio),
                )

                raw_contribution = ratio * advantage
                clipped_contribution = clipped_ratio * advantage
                if raw_contribution <= clipped_contribution + 1e-12:
                    coefficient = ratio * advantage
                    for candidate in range(action_count):
                        score = (
                            (1.0 if candidate == action else 0.0)
                            - probabilities[candidate]
                        )
                        policy_gradient[state][candidate] += coefficient * score

                entropy = -sum(
                    probability * math.log(max(probability, 1e-12))
                    for probability in probabilities
                )
                for candidate, probability in enumerate(probabilities):
                    entropy_gradient = -probability * (
                        math.log(max(probability, 1e-12)) + entropy
                    )
                    policy_gradient[state][candidate] += (
                        PPO_ENTROPY_COEFFICIENT * entropy_gradient
                    )

                value_gradient[state] += target - values[state]

            scale = 1.0 / len(minibatch)
            for state in range(state_count):
                values[state] += PPO_VALUE_RATE * scale * value_gradient[state]
                for action in range(action_count):
                    theta[state][action] += (
                        PPO_POLICY_RATE
                        * scale
                        * policy_gradient[state][action]
                    )
                    theta[state][action] = max(
                        -12.0, min(12.0, theta[state][action])
                    )


def train(
    algorithm: str,
    episodes: int,
    seed: int,
    checkpoints: set[int],
) -> dict[str, object]:
    rng = random.Random(seed)
    state_count = ROWS * COLS
    theta = [[0.0 for _ in ACTIONS] for _ in range(state_count)]
    values = [0.0 for _ in range(state_count)]
    episode_returns: list[float] = []
    snapshots: list[dict[str, object]] = []
    ppo_samples: list[tuple[int, int, float, float, float]] = []
    optimizer_rng = random.Random(seed + 100_003)

    if algorithm == "reinforce":
        policy_rate, value_rate = 0.10, 0.16
        display_name = "REINFORCE + baseline"
        update_note = "The value map changes after the episode ends."
    elif algorithm == "actor_critic":
        policy_rate, value_rate = 0.16, 0.20
        display_name = "One-step actor-critic"
        update_note = "The value map changes after every TD error."
    elif algorithm == "ppo":
        policy_rate, value_rate = 0.0, 0.0
        display_name = "PPO-Clip"
        update_note = (
            f"GAE and {PPO_UPDATE_EPOCHS} clipped epochs update each "
            f"{PPO_BATCH_EPISODES}-episode rollout batch."
        )
    else:
        raise ValueError(f"unknown algorithm: {algorithm}")

    for episode in range(1, episodes + 1):
        selected = episode in checkpoints
        state = START
        states: list[tuple[int, int]] = []
        actions: list[int] = []
        rewards: list[float] = []
        next_states: list[tuple[int, int]] = []
        terminals: list[bool] = []
        old_log_probabilities: list[float] = []
        old_values: list[float] = []
        path = [list(state)]
        value_frames = [flat_values(values)]

        for step in range(MAX_STEPS):
            probabilities = softmax(theta[state_index(state)])
            action = sample_action(probabilities, rng)
            next_state, reward, terminal = transition(state, action)
            states.append(state)
            actions.append(action)
            rewards.append(reward)
            next_states.append(next_state)
            terminals.append(terminal)

            if algorithm == "ppo":
                old_log_probabilities.append(
                    math.log(max(probabilities[action], 1e-12))
                )
                old_values.append(values[state_index(state)])

            if algorithm == "actor_critic":
                index = state_index(state)
                bootstrap = 0.0 if terminal else values[state_index(next_state)]
                td_error = reward + GAMMA * bootstrap - values[index]
                values[index] += value_rate * td_error
                policy_step(theta, state, action, policy_rate * td_error)

            state = next_state
            if selected:
                path.append(list(state))
                value_frames.append(flat_values(values))
            if terminal:
                break

        if algorithm == "reinforce":
            returns = [0.0 for _ in rewards]
            reward_to_go = 0.0
            for time in reversed(range(len(rewards))):
                reward_to_go = rewards[time] + GAMMA * reward_to_go
                returns[time] = reward_to_go

            for time, (visited_state, action, target) in enumerate(
                zip(states, actions, returns)
            ):
                index = state_index(visited_state)
                advantage = target - values[index]
                values[index] += value_rate * advantage
                scale = policy_rate * (GAMMA**time) * advantage
                policy_step(theta, visited_state, action, scale)

            # During REINFORCE the map is fixed while the trajectory unfolds;
            # the final frame reveals the episode-end Monte Carlo update.
            if selected:
                value_frames[-1] = flat_values(values)

        if algorithm == "ppo":
            advantages = [0.0 for _ in rewards]
            targets = [0.0 for _ in rewards]
            gae = 0.0
            for time in reversed(range(len(rewards))):
                bootstrap = (
                    0.0
                    if terminals[time]
                    else values[state_index(next_states[time])]
                )
                td_error = (
                    rewards[time]
                    + GAMMA * bootstrap
                    - old_values[time]
                )
                # A time-limit cutoff bootstraps the final observation but
                # does not continue the trace across the environment reset.
                trace_mask = 0.0 if time == len(rewards) - 1 else 1.0
                if terminals[time]:
                    trace_mask = 0.0
                gae = (
                    td_error
                    + GAMMA * PPO_GAE_LAMBDA * trace_mask * gae
                )
                advantages[time] = gae
                targets[time] = gae + old_values[time]

            ppo_samples.extend(
                (
                    state_index(visited_state),
                    action,
                    old_log_probability,
                    advantage,
                    target,
                )
                for (
                    visited_state,
                    action,
                    old_log_probability,
                    advantage,
                    target,
                ) in zip(
                    states,
                    actions,
                    old_log_probabilities,
                    advantages,
                    targets,
                )
            )

            batch_complete = (
                episode % PPO_BATCH_EPISODES == 0 or episode == episodes
            )
            if batch_complete:
                ppo_update(theta, values, ppo_samples, optimizer_rng)
                ppo_samples.clear()
                if selected:
                    value_frames[-1] = flat_values(values)

        total_reward = sum(rewards)
        episode_returns.append(total_reward)
        if selected:
            snapshots.append(
                {
                    "episode": episode,
                    "episode_return": round(total_reward, 6),
                    "path": path,
                    "value_frames": value_frames,
                }
            )

    result: dict[str, object] = {
        "algorithm": algorithm,
        "display_name": display_name,
        "update_note": update_note,
        "rows": ROWS,
        "cols": COLS,
        "start": list(START),
        "goal": list(GOAL),
        "walls": [list(cell) for cell in sorted(WALLS)],
        "action_names": list(ACTION_NAMES),
        "gamma": GAMMA,
        "episodes": episodes,
        "seed": seed,
        "episode_returns": [round(value, 6) for value in episode_returns],
        "snapshots": snapshots,
    }
    if algorithm == "ppo":
        result["ppo"] = {
            "gae_lambda": PPO_GAE_LAMBDA,
            "clip_epsilon": PPO_CLIP_EPSILON,
            "batch_episodes": PPO_BATCH_EPISODES,
            "update_epochs": PPO_UPDATE_EPOCHS,
            "minibatch_size": PPO_MINIBATCH_SIZE,
            "policy_rate": PPO_POLICY_RATE,
            "value_rate": PPO_VALUE_RATE,
            "entropy_coefficient": PPO_ENTROPY_COEFFICIENT,
        }
    return result


def checkpoint_set(
    episodes: int, checkpoint_text: str, render_every: int
) -> set[int]:
    checkpoints = {
        int(item.strip())
        for item in checkpoint_text.split(",")
        if item.strip()
    }
    if render_every > 0:
        checkpoints.update(range(1, episodes + 1, render_every))
    checkpoints.add(episodes)
    return {episode for episode in checkpoints if 1 <= episode <= episodes}


def moving_average(values: list[float], window: int = 20) -> float:
    tail = values[-window:]
    return sum(tail) / len(tail)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--algorithm",
        choices=("reinforce", "actor_critic", "ppo", "both", "all"),
        default="all",
    )
    parser.add_argument("--episodes", type=int, default=220)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--checkpoints",
        default="1,3,10,25,50,100,160,220",
        help="comma-separated episodes whose trajectories are animated",
    )
    parser.add_argument(
        "--render-every",
        type=int,
        default=0,
        help="also animate every Nth episode; use 1 for every episode",
    )
    parser.add_argument(
        "--output-label",
        default="animation-data",
        help="text placed after the algorithm name in each JSON filename",
    )
    parser.add_argument(
        "--gzip",
        action="store_true",
        help="also write a deterministic .json.gz copy for the web app",
    )
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    checkpoints = checkpoint_set(
        args.episodes, args.checkpoints, args.render_every
    )
    if args.algorithm == "all":
        algorithms = ("reinforce", "actor_critic", "ppo")
    elif args.algorithm == "both":
        algorithms = ("reinforce", "actor_critic")
    else:
        algorithms = (args.algorithm,)

    for algorithm in algorithms:
        data = train(algorithm, args.episodes, args.seed, checkpoints)
        output = args.output_dir / f"{algorithm}-{args.output_label}.json"
        payload = json.dumps(data, separators=(",", ":"))
        output.write_text(payload)
        if args.gzip:
            compressed_output = output.with_suffix(output.suffix + ".gz")
            compressed_output.write_bytes(
                gzip.compress(payload.encode("utf-8"), compresslevel=9, mtime=0)
            )
        final_average = moving_average(data["episode_returns"])  # type: ignore[arg-type]
        print(
            f"{algorithm}: wrote {output.name}; "
            f"{'wrote ' + compressed_output.name + '; ' if args.gzip else ''}"
            f"final 20-episode mean return = {final_average:.3f}"
        )


if __name__ == "__main__":
    main()
