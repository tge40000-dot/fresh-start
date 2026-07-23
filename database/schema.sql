-- Relentless Billionaire - D1 Database Schema

-- Agent Status Table
CREATE TABLE IF NOT EXISTS agent_status (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'idle',
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    version TEXT DEFAULT '2.0',
    environment TEXT DEFAULT 'production'
);

-- Analysis Results
CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    language TEXT,
    analysis_data JSON,
    issues_found INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_path)
);

-- ML Model Training Data
CREATE TABLE IF NOT EXISTS ml_training_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT NOT NULL,
    features JSON NOT NULL,
    accuracy REAL,
    trained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- RL Decision History
CREATE TABLE IF NOT EXISTS rl_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,
    parameters JSON,
    confidence REAL,
    reward REAL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task Queue
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    priority INTEGER DEFAULT 3,
    status TEXT DEFAULT 'pending',
    result TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agent_status_date ON agent_status(last_check);
CREATE INDEX IF NOT EXISTS idx_analyses_path ON analyses(file_path);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_rl_timestamp ON rl_decisions(timestamp);
