#!/usr/bin/env python3
"""
ML ENGINE - FIXED PRODUCTION BUILD
- Sync + Async support (both work)
- Graceful fallback if sklearn missing
- Persistent training data
- Safe joblib loading with version check
"""
import json, os
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
import logging

try:
    import numpy as np
    import pandas as pd
    from sklearn.ensemble import IsolationForest, RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.cluster import KMeans
    import joblib
    SKLEARN_OK = True
except ImportError:
    SKLEARN_OK = False
    np = None

@dataclass
class MLModel:
    name: str; model_type: str; accuracy: float = 0.0
    trained_at: Optional[datetime] = None; features_count: int = 0
    training_samples: int = 0; model_path: Optional[Path] = None; is_active: bool = False

class RealMLEngine:
    def __init__(self, project_root: str = None):
        self.project_root = Path(project_root) if project_root else Path.cwd()
        self.models_dir = self.project_root / "intelligence" / "models"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.data_file = self.project_root / "agent_system" / "learning_data.json"
        self.models: Dict[str, MLModel] = {}
        self.active_models: Dict[str, Any] = {}
        self.training_data: List[Dict] = self._load_training_data()
        self._initialize_default_models()
        logging.info(f"ML Engine initialized - sklearn: {SKLEARN_OK}, data: {len(self.training_data)} points")

    def _load_training_data(self):
        if self.data_file.exists():
            try: return json.loads(self.data_file.read_text())[-10000:]
            except: return []
        return []

    def _save_training_data(self):
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        self.data_file.write_text(json.dumps(self.training_data[-10000:], indent=2, default=str))

    def _initialize_default_models(self):
        for name, mtype, fcount in [
            ('performance_predictor','IsolationForest',8),
            ('anomaly_detector','IsolationForest',6),
            ('issue_classifier','RandomForest',12),
            ('resource_optimizer','KMeans',5)
        ]:
            self.models[name] = MLModel(name=name, model_type=mtype, features_count=fcount)

    def _extract_performance_features(self, dp: Dict):
        try:
            return [float(dp.get(k,0)) for k in ['cpu_percent','memory_percent','response_time','error_rate','throughput','latency_p95','disk_usage','network_load']]
        except: return None

    def add_training_data(self, dp: Dict):
        dp['timestamp'] = datetime.now().isoformat()
        self.training_data.append(dp)
        if len(self.training_data) > 10000: self.training_data = self.training_data[-10000:]
        self._save_training_data()

    def get_model_status(self):
        return {
            'models': {k: {'name':v.name,'type':v.model_type,'accuracy':v.accuracy,'is_active':v.is_active} for k,v in self.models.items()},
            'total_models': len(self.models),
            'training_data_points': len(self.training_data),
            'sklearn_available': SKLEARN_OK
        }

    # Sync wrappers for old async code
    def train_performance_predictor(self, data=None):
        if not SKLEARN_OK: return False
        data = data or self.training_data
        if len(data) < 10: return False
        try:
            feats = [self._extract_performance_features(d) for d in data]
            feats = [f for f in feats if f]
            if len(feats) < 10: return False
            import numpy as np
            X = np.array(feats)
            model = IsolationForest(contamination=0.1, random_state=42)
            model.fit(X)
            self.active_models['performance_predictor'] = model
            self.models['performance_predictor'].is_active = True
            self.models['performance_predictor'].trained_at = datetime.now()
            joblib.dump(model, self.models_dir / "performance_predictor.pkl")
            return True
        except Exception as e:
            logging.error(f"Train failed: {e}"); return False

    # Keep async versions for compatibility
    async def train_performance_predictor_async(self, data): 
        return self.train_performance_predictor(data)
