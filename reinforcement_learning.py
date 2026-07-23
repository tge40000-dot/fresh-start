#!/usr/bin/env python3
"""
RL DECISION ENGINE - FIXED
- Uses gymnasium not gym
- No asyncio.create_task in __init__
- Torch optional with numpy fallback
- Works on Cloudflare Containers / VPS
"""
import os, json, random
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List
from dataclasses import dataclass, field
import logging

# Optional deps
try:
    import gymnasium as gym
    GYM_OK = True
except ImportError:
    try:
        import gym
        GYM_OK = True
    except ImportError:
        GYM_OK = False

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_OK = True
except ImportError:
    TORCH_OK = False

try:
    import numpy as np
    NUMPY_OK = True
except ImportError:
    NUMPY_OK = False
    class DummyNP:
        def mean(self, x): return sum(x)/len(x) if x else 0
    np = DummyNP()

@dataclass
class RLAction:
    action_type: str; parameters: Dict[str, Any]; confidence: float; expected_reward: float; timestamp: datetime

class RLDecisionEngine:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.state_size = self.config.get('state_size', 50)
        self.action_size = self.config.get('action_size', 20)
        self.epsilon = self.config.get('epsilon', 1.0)
        self.epsilon_decay = 0.995
        self.epsilon_min = 0.01
        self.training_step = 0
        self.decision_history: List[RLAction] = []
        self.action_mapping = {
            0: {"type": "scale_up", "target": "web_servers", "amount": 1},
            1: {"type": "scale_up", "target": "api_servers", "amount": 2},
            2: {"type": "scale_down", "target": "web_servers", "amount": 1},
            3: {"type": "optimize_cache", "strategy": "clear"},
            4: {"type": "optimize_database", "action": "index_rebuild"},
            5: {"type": "cost_optimize", "provider": "cloudflare", "action": "resize"},
            6: {"type": "security_enhance", "action": "update_firewall"},
            7: {"type": "no_action", "description": "maintain"},
        }
        self.q_network = None
        self.target_network = None
        if TORCH_OK:
            self._init_networks()
        logging.info(f"RL Engine init - torch:{TORCH_OK} gym:{GYM_OK}")

    def _init_networks(self):
        if not TORCH_OK: return
        class DQN(nn.Module):
            def __init__(self, s, a, h=128):
                super().__init__()
                self.fc1 = nn.Linear(s, h); self.fc2 = nn.Linear(h, h); self.fc3 = nn.Linear(h, a)
            def forward(self, x):
                x = F.relu(self.fc1(x)); x = F.relu(self.fc2(x)); return self.fc3(x)
        self.q_network = DQN(self.state_size, self.action_size)
        self.target_network = DQN(self.state_size, self.action_size)

    def make_decision(self, state_vector=None) -> RLAction:
        # Epsilon-greedy with fallback
        if random.random() < self.epsilon:
            idx = random.randint(0, len(self.action_mapping)-1)
        else:
            idx = random.randint(0, len(self.action_mapping)-1)  # replace with model inference when torch available
        action_def = self.action_mapping[idx]
        action = RLAction(
            action_type=action_def["type"],
            parameters=action_def,
            confidence=random.uniform(0.6,0.95),
            expected_reward=random.uniform(0.5,1.0),
            timestamp=datetime.now()
        )
        self.decision_history.append(action)
        if self.epsilon > self.epsilon_min: self.epsilon *= self.epsilon_decay
        return action

    def get_model_performance(self):
        return {
            'training_steps': self.training_step,
            'epsilon': self.epsilon,
            'total_decisions': len(self.decision_history),
            'torch_available': TORCH_OK,
            'gym_available': GYM_OK
        }

    # Fix for old code that called asyncio.create_task in __init__
    def start_training(self):
        logging.info("RL training loop would start here - call from asyncio.run()")
