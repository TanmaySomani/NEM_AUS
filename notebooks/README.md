# Executable research notebooks

Run these four notebooks in numbered order, or independently from a fresh kernel. Each locates the repository root, imports the shared analysis, and explains its assumptions. Saved outputs are produced by executing every code cell, not pasted from the old report.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/execute_notebooks.py
```

The forecasting notebook retrains the canonical CPU models and checks agreement with the published artifact. It writes ignored local model files; it does not overwrite the dashboard artifact. Regenerate the dashboard explicitly with `scripts/build_data.py` when desired.

Select `.venv/bin/python` as the kernel in your notebook editor. The old notebooks are retained in [`archive/notebooks`](../archive/notebooks/README.md).
