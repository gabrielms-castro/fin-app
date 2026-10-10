"""Ciclo de fatura do cartão de crédito.

Regra: compra feita antes do dia de fechamento entra na fatura que fecha neste
mês; no dia do fechamento ou depois, na fatura seguinte. A fatura vence no
mesmo mês do fechamento se due_day > closing_day, senão no mês seguinte.
A competência (mês do orçamento) é o mês de vencimento.
"""

from .dates import add_months, clamp_day, month_start


def _due_offset(card):
    return 0 if card.due_day > card.closing_day else 1


def invoice_cycle(card, purchase_date):
    """Retorna (competence, closing_date, due_date) da fatura onde cai a compra."""
    closing_month = month_start(purchase_date)
    closing = clamp_day(closing_month, card.closing_day)
    if purchase_date >= closing:
        closing_month = add_months(closing_month, 1)
        closing = clamp_day(closing_month, card.closing_day)
    due = clamp_day(add_months(closing_month, _due_offset(card)), card.due_day)
    return month_start(due), closing, due


def cycle_for_competence(card, competence):
    """Retorna (closing_date, due_date) da fatura que vence no mês `competence`."""
    competence = month_start(competence)
    closing = clamp_day(add_months(competence, -_due_offset(card)), card.closing_day)
    return closing, clamp_day(competence, card.due_day)
