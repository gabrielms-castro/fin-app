import calendar
from datetime import date

from dateutil.relativedelta import relativedelta
from django.utils import timezone


def today():
    return timezone.localdate()


def month_start(d):
    return d.replace(day=1)


def add_months(d, n):
    return d + relativedelta(months=n)


def clamp_day(month, day):
    """Data no `day` do mês de `month`, limitado ao último dia do mês."""
    last = calendar.monthrange(month.year, month.month)[1]
    return date(month.year, month.month, min(day, last))


def parse_month(value, default=None):
    """Aceita 'YYYY-MM' ou 'YYYY-MM-DD' e devolve o 1º dia do mês."""
    if not value:
        return default
    parts = str(value).split("-")
    try:
        return date(int(parts[0]), int(parts[1]), 1)
    except (ValueError, IndexError):
        return default


def iter_months(start, end):
    current = month_start(start)
    while current <= end:
        yield current
        current = add_months(current, 1)
