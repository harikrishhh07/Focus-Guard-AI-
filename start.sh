#!/usr/bin/env bash
echo "===================================================================="
echo "  FocusGuard AI -- Starting Web App and AI Vision Attention Tracker"
echo "===================================================================="

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

if [ -f "./venv_mac/bin/python" ]; then
    PYTHON_CMD="./venv_mac/bin/python"
elif [ -f "./venv/bin/python" ]; then
    PYTHON_CMD="./venv/bin/python"
else
    PYTHON_CMD="python3"
fi

echo "Using Python: $PYTHON_CMD"
$PYTHON_CMD manage.py runserver 127.0.0.1:8000
