from decimal import Decimal

from .dates import today
from .investments import balance

ZERO = Decimal("0")
CENT = Decimal("0.01")


def months_between(start, end):
    return (end.year - start.year) * 12 + end.month - start.month


def goal_progress(goal, reference=None):
    """Quanto já foi juntado e quanto guardar por mês para bater a meta no prazo."""
    reference = reference or today()
    saved = balance(goal.investment) if goal.investment_id else goal.initial_amount
    remaining = max(goal.target_amount - saved, ZERO)
    months_left = max(months_between(reference, goal.target_date), 1) if goal.target_date else None
    if months_left is None:
        suggested = None
    elif remaining == 0:
        suggested = ZERO
    else:
        suggested = (remaining / months_left).quantize(CENT)
    return {
        "saved": saved,
        "remaining": remaining,
        "progress_pct": min(max(saved / goal.target_amount * 100, ZERO), Decimal(100)).quantize(CENT),
        "months_left": months_left,
        "suggested_monthly": suggested,
    }
