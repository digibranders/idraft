"""The intent and funnel stage of a prompt, read from its wording.

A prompt typed in by hand carries no intent, and the Prompts page shows `n/a` for it. This module
gives one by fixed rules over the case-folded text: no model is asked and nothing costs money.
The rules run in order and the first match wins, so the strongest signal decides:

1. `navigational`: a login or official-site marker, or a bare domain name.
2. `local`: an explicit place marker such as "near me", "nearby" or "local providers".
3. `commercial`: comparing or choosing between sellers ("best", "top 10", "compare", "vs",
   "alternatives", "which vendors", "reviews", "recommend").
4. `informational`, when the text opens with a how, why or what-is form. This sits before the
   price words so that "How does pricing work" is a question about pricing, not a purchase.
5. `transactional`: a buying act or a price word ("cost", "pricing", "quote", "hire", "free trial",
   "book a demo").
6. `informational`, the default for any other text.

Empty text has no intent: `unknown`. The funnel stage follows the intent (`FUNNEL_OF`).
"""

from __future__ import annotations

import re
from typing import Final, Literal

Intent = Literal["informational", "navigational", "commercial", "transactional", "local", "unknown"]
FunnelStage = Literal["tofu", "mofu", "bofu", "unknown"]

FUNNEL_OF: Final[dict[Intent, FunnelStage]] = {
    "informational": "tofu",
    "commercial": "mofu",
    "local": "mofu",
    "transactional": "bofu",
    "navigational": "bofu",
    "unknown": "unknown",
}

_SELLERS: Final = (
    r"(?:providers?|vendors?|companies|firms|agencies|tools|services|platforms|products|"
    r"software|solutions|consultants?|suppliers?|partners?|alternatives)"
)
_NAVIGATIONAL: Final = re.compile(
    r"\b(?:log ?in|sign ?in|official (?:web ?)?site|home ?page|customer portal)\b"
)
# A short query that is only a domain name ("eventus.com", "go to acme.io").
_DOMAIN: Final = re.compile(r"\b[a-z0-9][a-z0-9-]*\.(?:[a-z]{2,}\.)?[a-z]{2,}\b")
_NAVIGATIONAL_MAX_WORDS: Final = 3
_LOCAL: Final = re.compile(
    r"\b(?:near me|nearby|near by|close to me|around me|in my area|in my city)\b"
    rf"|\blocal (?!seo\b|search\b)(?:\w+ ){{0,2}}{_SELLERS}\b"
)
_COMMERCIAL: Final = re.compile(
    r"\b(?:compare|comparison|compared|versus|vs\.?|alternatives?|reviews?|rated|"
    r"recommend(?:ed|ation|ations)?|leading|better than|cheaper than|"
    r"top (?:\d+|rated)|top-rated|best(?! practices?\b| way\b| ways\b))\b"
    rf"|\bwhich (?:\w+ ){{0,3}}{_SELLERS}\b"
)
_INFORMATIONAL_LEAD: Final = re.compile(
    r"^(?:what (?:is|are|does|do|was)|how (?:does|do|did|to|can|is|are)|why|"
    r"explain|define|difference between|meaning of|guide to)\b"
)
_TRANSACTIONAL: Final = re.compile(
    r"\b(?:price|prices|pricing|cost|costs|how much|cheap|cheapest|affordable|quote|quotes|"
    r"buy|purchase|order|hire|subscribe|subscription|discount|coupon|free trial|"
    r"book (?:a |an )?(?:demo|call|consultation)|request (?:a |an )?(?:demo|quote)|"
    r"get started|sign up)\b"
)


def classify_prompt_intent(text: str) -> tuple[Intent, FunnelStage]:
    """The intent and funnel stage the wording of `text` gives; `unknown` for empty text."""
    folded = " ".join(text.casefold().split())
    if not folded:
        return "unknown", "unknown"
    intent = _intent(folded)
    return intent, FUNNEL_OF[intent]


def _intent(folded: str) -> Intent:
    if _NAVIGATIONAL.search(folded) or (
        len(folded.split()) <= _NAVIGATIONAL_MAX_WORDS and _DOMAIN.search(folded)
    ):
        return "navigational"
    if _LOCAL.search(folded):
        return "local"
    if _COMMERCIAL.search(folded):
        return "commercial"
    if _INFORMATIONAL_LEAD.match(folded):
        return "informational"
    if _TRANSACTIONAL.search(folded):
        return "transactional"
    return "informational"
