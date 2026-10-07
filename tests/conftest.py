"""Configuração comum dos testes (pytest)."""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Ferramentas manuais que ficam na pasta tests/ mas não são testes automáticos:
# - test_vison.py abre janelas do OpenCV para calibrar a ROI e travaria o CI.
# - simulate_dashboard.py sobe um servidor com o carro simulado.
collect_ignore = ["test_vison.py", "simulate_dashboard.py"]
