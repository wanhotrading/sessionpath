// Generated from the source Day review export by build-knowledge.mjs.
export const DAY_REVIEW_KNOWLEDGE = {
  "schema": "sessionpath.day-review.knowledge.v1",
  "source": {
    "spreadsheetId": "1_FOxbdxo7x0OOTzjuA3hWiYrMTE6pI5Uy1WastnMlp0",
    "sheetId": 1087870928,
    "sheetName": "Day review",
    "url": "https://docs.google.com/spreadsheets/d/1_FOxbdxo7x0OOTzjuA3hWiYrMTE6pI5Uy1WastnMlp0/edit?gid=1087870928",
    "readDate": "2026-11-07"
  },
  "columns": {
    "A": "Date",
    "B": "Source row",
    "C": "Explicit contract",
    "D": "New full-day screenshot",
    "E": "Prior BBOX high",
    "F": "Prior BBOX low",
    "G": "BBOX width",
    "H": "Asia IB location",
    "I": "Asia after IB path",
    "J": "London IB location",
    "K": "London after IB path",
    "L": "NY IB path",
    "M": "NY after IB path",
    "N": "BBOX exploration to16:00",
    "O": "NY close vs prior BBOX",
    "P": "Full-day tag (known16:00)",
    "Q": "Whole-day sequence",
    "R": "Phase combination (all years)",
    "S": "BBOX location sequence",
    "T": "Event tags (all years)",
    "U": "UD/Q (original / derived)",
    "V": "Gap (original / derived)",
    "W": "Asia-Q2 (original / derived)",
    "X": "Breakout labels (original / derived)",
    "Y": "London0.5 (original / derived)",
    "Z": "Session handoff (original / derived)"
  },
  "clocks": {
    "timezone": "America/New_York",
    "convention": "DST-aware five-minute bar OPEN timestamps, start included and end excluded. A close-confirmed event is known five minutes after its bar opens.",
    "NTA": {
      "segments": [
        "prior complete NY date 16:00–17:00",
        "preceding calendar evening 18:00–19:30"
      ],
      "weekend": "Friday and Sunday for Monday; omit the closed gap."
    },
    "ASIA": {
      "IB": "19:30–20:30",
      "AIB": "20:30–02:00",
      "full": "19:30–02:00"
    },
    "ATL": "02:00–03:00",
    "LONDON": {
      "IB": "03:00–04:00",
      "AIB": "04:00–08:30",
      "full": "03:00–08:30"
    },
    "LTN": "08:30–09:30",
    "NY": {
      "IB": "09:30–10:30",
      "AIB": "10:30–16:00",
      "full": "09:30–16:00"
    },
    "forecastNY": "08:30–16:00",
    "endpoint": "For a 16:00 completed-close deadline, use the 15:55-open candle close. The displayed 16:00-open candle is later visual context."
  },
  "layers": {
    "phaseProse": "H:M describes the IB action and subsequent path. Q connects the chronological whole-day story, including ATL/LTN when stated. A first-hour move can be retraced later.",
    "formalShapes": "R records completed-session Narrow/order/final-close-position codes. Apply the exact Tagdictionary rules to sufficient evidence. Prose recovery or expansion alone does not determine the code.",
    "bboxLocations": "S records endpoint positions within the fixed prior complete NY BBOX. A session can recover toward its own high while staying below BBOX. N records full-day wick exploration; O records the final NY closing relationship.",
    "eventTags": "T contains events with different known-at times. Use each dictionary deadline before applying a label to an earlier observation.",
    "legacy": "U:Z preserves original or derived legacy annotations. Prefer the uniform all-year R/S/T series for defined comparisons, retaining legacy provenance."
  },
  "londonExtension": {
    "meaning": "L05 means the London 0.5 extension.",
    "anchor": "London IB 03:00–04:00.",
    "upper": "IB high + 0.5 × IB width",
    "lower": "IB low − 0.5 × IB width",
    "distinctions": "Its anchor differs from the SessionPath mean forecast box and the full-box 1.2×/1.3× range-multiple lines. Record touch, close-back and regained/endpoint states separately."
  },
  "evidence": {
    "sourceRows": 1233,
    "coverageUnavailableRows": 12,
    "provenance": "Researchguide describes 26 provisional individual chart reviews and later programmatic path reconstructions. The current 26-column table has no dedicated row-level review-status field. A linked screenshot alone confirms neither a fresh image audit nor exact event ordering.",
    "timeLimits": "Full-day labels P, final BBOX exploration/close labels N/O and later phase outcomes become available at their recorded deadlines. Missing coverage stays unknown. Keep unfinished phases and later outcomes out of live filters.",
    "teaching": "The four quoted cases are source examples. Their formal codes are retained as separate source annotations. Broad visual agreement does not independently validate their exact formal classifications."
  },
  "staleGuideReferences": [
    {
      "legacy": "Whole-day sequence U",
      "current": "Q"
    },
    {
      "legacy": "Phase columns L:Q",
      "current": "H:M"
    },
    {
      "legacy": "Screenshot H",
      "current": "D"
    },
    {
      "legacy": "Handoff AC",
      "current": "Z"
    },
    {
      "legacy": "Evidence/status E and V",
      "current": "No dedicated status column; E is Prior BBOX high and V is Gap."
    }
  ],
  "tagDictionary": {
    "headers": [
      "Area",
      "Tag / term",
      "Exact definition",
      "Known when"
    ],
    "entries": [
      {
        "area": "Scope",
        "term": "v2.0 labels",
        "definition": "Uniform rules across2022–2026; full-day descriptive tags, not inferred trade signals.",
        "knownWhen": "After relevant session ends"
      },
      {
        "area": "Source",
        "term": "D: prefix",
        "definition": "Original annotation absent; reconstructed from explicit CL contract5m data. Original nonempty labels remain unchanged. Original and derived legacy fields are not a uniform statistical series; use new all-year tags.",
        "knownWhen": "Final outcome"
      },
      {
        "area": "Missing",
        "term": "COVERAGE_UNAVAILABLE",
        "definition": "Required source window missing. Never treat as no breakout, no gap, or a losing setup. Twelve Day review dates lack measured-day tags.",
        "knownWhen": "Coverage audit"
      },
      {
        "area": "Shape inputs",
        "term": "H,L,C,R,cp",
        "definition": "Within each named session: H=max high,L=min low,C=last close,R=H−L,cp=(C−L)/R. W=prior NY BBOX width. Compare first-occurrence high and low bars.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape precedence",
        "term": "NARROW",
        "definition": "R<0.18W; evaluated before all other shapes. This describes compact range, not a guarantee of later expansion.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape",
        "term": "UP_FINISH",
        "definition": "Session low occurs before high; final close is in top25% of session range. May contain an initial selloff; does not necessarily mean close>open.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape",
        "term": "RALLY_FADE",
        "definition": "Low before high; final close is in bottom30% of session range.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape",
        "term": "UP_THEN_PULLBACK",
        "definition": "Low before high; close position strictly between30% and75%.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape",
        "term": "DOWN_FINISH",
        "definition": "High before low; final close is in bottom25% of session range.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape",
        "term": "DROP_RECOVERY",
        "definition": "High before low; final close is in top30% of session range.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape",
        "term": "DOWN_THEN_BOUNCE",
        "definition": "High before low; close position strictly between25% and70%.",
        "knownWhen": "Session end"
      },
      {
        "area": "Shape",
        "term": "ORDER_UNRESOLVED",
        "definition": "First session high and low appear in same5m bar; no assumed intrabar ordering.",
        "knownWhen": "Session end"
      },
      {
        "area": "Phase windows",
        "term": "PRIOR_NY / NTA / ASIA / LONDON / NY",
        "definition": "Prior NY09:30–16; NTA uses available bars after prior16 until19:30 anchor, including closed weekend gaps with no invented bars; Asia19:30–02; London03–08:30; NY09:30–16. ATL and LTN remain in whole-day prose.",
        "knownWhen": "02 /08:30 /16 for main phases"
      },
      {
        "area": "Clock convention",
        "term": "All times New York local",
        "definition": "DST-aware. Interval includes starting bar and excludes ending bar. Bar timestamp is its OPEN; close-confirmed event usable five minutes later.",
        "knownWhen": "As specified"
      },
      {
        "area": "BBOX locations",
        "term": "Q1,Q2,Q3,Q4,ABOVE,BELOW",
        "definition": "q=(price−priorL)/(priorH−priorL). Q1:[0,.25),Q2:[.25,.5),Q3:[.5,.75),Q4:[.75,1]. Exact top isQ4; outside remains ABOVE/BELOW. Q2LD is midpoint, not an entire quarter.",
        "knownWhen": "At endpoint shown"
      },
      {
        "area": "UD/Q",
        "term": "NY2NY_U/Q1 or D/Q4",
        "definition": "From prior16 to current09:30: only upper wick exit with a distinct earlier bar visitingQ1, or only lower exit with earlierQ4 visit. U/X,D/X=other single-side exits; BOTH=both edges; I=neither. Same-bar visit/exit not ordered.",
        "knownWhen": "09:30"
      },
      {
        "area": "Gap",
        "term": "GAP_UG / GAP_DG / GAP_NO_GAP",
        "definition": "Current09:30 open above priorH / below priorL / inside. Size measured to nearest edge, in prior BBOX quarters. Original2022 legacy NA/UG/DG may differ; preserved, not silently relabeled.",
        "knownWhen": "09:30"
      },
      {
        "area": "Gap",
        "term": "GAP_FILLED_HH:MM",
        "definition": "First5m bar touching prior edge; event becomes confirmed by bar end. A filled gap may reopen later; first fill remains recorded.",
        "knownWhen": "First touch bar end"
      },
      {
        "area": "AVR",
        "term": "AVR75_BEFORE03 /03_05 /AFTER05 /NOT_REACHED",
        "definition": "First bar whose running19:30–08:30 high−low reaches75% of mean last10 complete NY ranges, same contract. BEFORE03 includes crossing02:55 bar, known03:00. Other bands likewise use bar-open timestamps.",
        "knownWhen": "Crossing bar end"
      },
      {
        "area": "AVR anchor",
        "term": "U,D,R at time t",
        "definition": "O=19:30 open; U=max high so far−O; D=O−min low so far; R=U+D. All nonnegative. A range estimate is not a preallocated upside/downside budget.",
        "knownWhen": "As-of t"
      },
      {
        "area": "Asia",
        "term": "ASIA_EXIT_UP/DOWN/BOTH",
        "definition": "First outside observation19:30–02, wick based. If already outside at19:30, this is not proof Asia initiated the breakout; ORDER_CHECK flags source ambiguity.",
        "knownWhen": "Observation bar end"
      },
      {
        "area": "Asia",
        "term": "MID_RETURN / LONDON_REEXIT_side",
        "definition": "After first Asia outside observation, midpoint touch before08:30, then London outside observation after03. Not necessarily midpoint before03; source Q2 flags show same-bar timing uncertainty.",
        "knownWhen": "Event bar end"
      },
      {
        "area": "Breakout labels",
        "term": "Session list",
        "definition": "Unique sessions with new wick exit after a completed close inside resets episode. Same session may contain multiple episodes but appears once. LondonAIB split before06/after06. Same-bar path ambiguity retained in original BBOX episode data.",
        "knownWhen": "09:30 for final list"
      },
      {
        "area": "London",
        "term": "0.5 extension",
        "definition": "L05 in event tags means London0.5, not05:00. UP=LondonIB high+.5×IB width; DOWN=IB low−.5×IB width, IB03–04. This is a half-range extension, not statistical standard deviation.",
        "knownWhen": "Levels known04:00"
      },
      {
        "area": "London",
        "term": "NOT_REACHED",
        "definition": "No touch of that extension04–08:30. This final-day label cannot be used at05. Pattern evidence has separate state known05.",
        "knownWhen": "08:30"
      },
      {
        "area": "London",
        "term": "TOUCHED_REJECTED",
        "definition": "Touched extension but final08:30 close is not beyond it. Does not prove it remained inside throughout.",
        "knownWhen": "08:30"
      },
      {
        "area": "London",
        "term": "REJECTED_THEN_REGAINED",
        "definition": "After extension touch, later bar closes back inside; final08:30 close is beyond extension again.",
        "knownWhen": "08:30"
      },
      {
        "area": "London",
        "term": "CLOSE_BEYOND",
        "definition": "Final08:30 close beyond touched level, without observed later-bar close-back in source state. Does not guarantee continuous holding or future continuation.",
        "knownWhen": "08:30"
      },
      {
        "area": "Catalog",
        "term": "296 phase/event groups",
        "definition": "Includes frequent and rare completed-day combinations. Counts include shortened measured days; exclude COVERAGE_CHECK for full-day comparisons. Full three-session combinations are sparse.",
        "knownWhen": "Descriptive only"
      },
      {
        "area": "Catalog filtering",
        "term": "Text contains",
        "definition": "Copy combination into filter on Day review R; location pattern intoS; event tag intoT. Gap-fill bands also appear directly inT as GAP_FILL_BEFORE1030, GAP_FILL_1030_1200 and GAP_FILL_AFTER1200.",
        "knownWhen": "Review navigation"
      },
      {
        "area": "Quant episode",
        "term": "Close-confirmed BBOX episode",
        "definition": "First inside-close→outside-close transition each day. First later inside close defines return; next outside close defines same/opposite. Already-outside start or jumping between outside sides without inside close is not a new confirmed-return episode.",
        "knownWhen": "Next bar after confirmation"
      },
      {
        "area": "Model outcomes",
        "term": "Cost assumptions",
        "definition": "Prices inCL points. Round-trip0/2/4/8 ticks =0/.02/.04/.08 points. Primary4 ticks=$40 per fullCL contract. Actual commissions/slippage not supplied.",
        "knownWhen": "Before selecting model"
      },
      {
        "area": "Uncertainty",
        "term": "Historical stability",
        "definition": "2022–24 vs2025–26 and annual breakdowns are stability checks, not untouched holdout. All history already informed research. Wilson and month-block bootstrap intervals are descriptive, not multiple-testing-adjusted significance.",
        "knownWhen": "Research qualification"
      },
      {
        "area": "Visual provenance",
        "term": "Price reconstruction",
        "definition": "Tags and tests use saved five-minute bars. This update does not claim a fresh manual inspection of every screenshot. Existing26 individual chart reviews and418 unresolved screenshot date/OCR exceptions remain separate.",
        "knownWhen": "Evidence quality"
      }
    ]
  },
  "workedExamples": [
    {
      "date": "2022-01-04",
      "contract": "CLG2022",
      "source": {
        "sheetRow": 3,
        "permalink": "https://docs.google.com/spreadsheets/d/1_FOxbdxo7x0OOTzjuA3hWiYrMTE6pI5Uy1WastnMlp0/edit?gid=1087870928#gid=1087870928&range=A3:Z3",
        "screenshot": "https://drive.google.com/file/d/18_hQtznzK9R8A5AtEKalsDhgUxvCxFDw/view?usp=drivesdk"
      },
      "cells": {
        "H": "Upper half / upside test",
        "I": "Return inside without midpoint touch",
        "J": "Upper half",
        "K": "Upside expansion, pullback, renewed expansion",
        "L": "Upside expansion",
        "M": "Retrace, recovery and balance",
        "Q": "Prior NY recovered. Asia tested above BBOX and returned inside; London dipped then expanded upward. The first upper extension rejected but was reclaimed before08:30. NY expanded higher and finished above the old BBOX.",
        "R": "PRIOR_NY:UP_THEN_PULLBACK | NTA:NARROW | ASIA:UP_THEN_PULLBACK | LONDON:UP_FINISH | NY:UP_THEN_PULLBACK",
        "S": "ASIA02:Q4 → LONDON0830:ABOVE → NY_CLOSE:ABOVE",
        "T": "NY2NY_U/X; GAP_UG; AVR75_AFTER05; ASIA_EXIT_UP; L05_UP_REJECTED_THEN_REGAINED; L05_DOWN_NOT_REACHED"
      },
      "review": {
        "level": "broad_visual_agreement",
        "scope": "The original screenshot broadly agrees with the phase narrative. Exact OHLC, every candle, formal shape thresholds and event timing were not revalidated."
      }
    },
    {
      "date": "2022-01-07",
      "contract": "CLG2022",
      "source": {
        "sheetRow": 6,
        "permalink": "https://docs.google.com/spreadsheets/d/1_FOxbdxo7x0OOTzjuA3hWiYrMTE6pI5Uy1WastnMlp0/edit?gid=1087870928#gid=1087870928&range=A6:Z6",
        "screenshot": "https://drive.google.com/file/d/1IEDjVk-ZIMb6hSVJmysFY9cybjli2a_W/view?usp=drivesdk"
      },
      "cells": {
        "H": "Rise toward upper area",
        "I": "Upside breakout then return",
        "J": "Sharp dip then reclaim",
        "K": "Upper extension failed; late selloff",
        "L": "Downside extension",
        "M": "Lower balance; close near prior low",
        "Q": "Asia extended above the old BBOX. London recovered from an early dip but its upside extension did not persist. Selling accelerated into NY; NY traded below the old BBOX and closed just inside its lower edge.",
        "R": "PRIOR_NY:DOWN_THEN_BOUNCE | NTA:UP_THEN_PULLBACK | ASIA:UP_FINISH | LONDON:UP_FINISH | NY:DOWN_THEN_BOUNCE",
        "S": "ASIA02:ABOVE → LONDON0830:ABOVE → NY_CLOSE:Q1",
        "T": "NY2NY_U/X; GAP_NO_GAP; AVR75_NOT_REACHED; ASIA_EXIT_UP; L05_UP_TOUCHED_REJECTED; L05_DOWN_NOT_REACHED"
      },
      "review": {
        "level": "broad_visual_agreement_with_endpoint_uncertainty",
        "scope": "The original screenshot broadly agrees with the phase narrative. Exact OHLC, every candle, formal shape thresholds and event timing were not revalidated.",
        "caveat": "Jan 7 displays a 16:00-open candle closing below the old low, while the source inside-close label uses the preceding 15:55-open candle. The tiny cutoff-sensitive inside/outside distinction remains unresolved in this visual audit. The sharp 08:30–09:30 decline belongs to LTN."
      }
    },
    {
      "date": "2022-01-20",
      "contract": "CLH2022",
      "source": {
        "sheetRow": 15,
        "permalink": "https://docs.google.com/spreadsheets/d/1_FOxbdxo7x0OOTzjuA3hWiYrMTE6pI5Uy1WastnMlp0/edit?gid=1087870928#gid=1087870928&range=A15:Z15",
        "screenshot": "https://drive.google.com/file/d/1nYtw9PPqzb_KrsklAFynBGJAyicwVIje/view?usp=drivesdk"
      },
      "cells": {
        "H": "Downside sweep below prior BBOX",
        "I": "Recovery through lower half to midpoint, then reversal",
        "J": "Lower-edge rotation with downside tests",
        "K": "Upper extension tested twice, then return to IB",
        "L": "Recovery into middle-to-upper BBOX",
        "M": "Upside breakout failed; afternoon selloff broke prior low",
        "Q": "Prior NY ended weak after an upside reversal. NTA and Asia traded below the old low; Asia recovered to the BBOX midpoint before fading. London rotated around the lower edge, made upside extensions and returned to IB. NY rallied above the old high, then reversed through the range and closed below the old low.",
        "R": "PRIOR_NY:DOWN_FINISH | NTA:DOWN_THEN_BOUNCE | ASIA:UP_THEN_PULLBACK | LONDON:RALLY_FADE | NY:DOWN_FINISH",
        "S": "ASIA02:Q2 → LONDON0830:Q1 → NY_CLOSE:BELOW",
        "T": "NY2NY_D/X; GAP_NO_GAP; AVR75_BEFORE03; ASIA_EXIT_DOWN; MID_RETURN; LONDON_REEXIT_DOWN; ORDER_CHECK; L05_UP_TOUCHED_REJECTED; L05_DOWN_NOT_REACHED"
      },
      "review": {
        "level": "broad_visual_agreement",
        "scope": "The original screenshot broadly agrees with the phase narrative. Exact OHLC, every candle, formal shape thresholds and event timing were not revalidated."
      }
    },
    {
      "date": "2022-01-21",
      "contract": "CLH2022",
      "source": {
        "sheetRow": 16,
        "permalink": "https://docs.google.com/spreadsheets/d/1_FOxbdxo7x0OOTzjuA3hWiYrMTE6pI5Uy1WastnMlp0/edit?gid=1087870928#gid=1087870928&range=A16:Z16",
        "screenshot": "https://drive.google.com/file/d/1epd0B6241W08UYx6H69YPgT2jW5LZ--d/view?usp=drivesdk"
      },
      "cells": {
        "H": "Deep downside excursion below prior BBOX",
        "I": "Recovery and rising balance, still below BBOX",
        "J": "Below-BBOX two-way rotation",
        "K": "Small downside probe then recovery; neither extension reached",
        "L": "Downside test after LTN recovery into BBOX",
        "M": "Recovery into Q1, balance and late pullback",
        "Q": "Prior NY sold off sharply and weakness continued through NTA. Asia made an early low then recovered. London remained below the prior BBOX and neither0.5 extension was reached by08:30. LTN reclaimed the lower BBOX area; NY retested below, then recovered and balanced inside its lower quarter.",
        "R": "PRIOR_NY:DOWN_FINISH | NTA:DOWN_FINISH | ASIA:UP_FINISH | LONDON:UP_FINISH | NY:UP_THEN_PULLBACK",
        "S": "ASIA02:BELOW → LONDON0830:BELOW → NY_CLOSE:Q1",
        "T": "NY2NY_D/X; GAP_NO_GAP; AVR75_BEFORE03; ASIA_EXIT_DOWN; ORDER_CHECK; L05_UP_NOT_REACHED; L05_DOWN_NOT_REACHED"
      },
      "review": {
        "level": "broad_visual_agreement",
        "scope": "The original screenshot broadly agrees with the phase narrative. Exact OHLC, every candle, formal shape thresholds and event timing were not revalidated."
      }
    }
  ]
};

export const DAY_REVIEW_READING_GUIDE = "Day review narrative reference\nLocate each phase on the time axis, including the day rollover. Trace actual candles within that phase. Describe the opening-range action, the after-IB expansion or retracement, any failed attempt or regain, and the handoff or final location. Use relative movement when prices are unreadable. Keep the current screenshot's story grounded in its visible candles.\nNew York clocks: Asia IB 19:30–20:30, AIB 20:30–02:00; ATL 02:00–03:00; London IB 03:00–04:00, AIB 04:00–08:30; LTN 08:30–09:30; NY IB 09:30–10:30, AIB 10:30–16:00. NTA uses prior NY 16:00–17:00 and evening 18:00–19:30. The NY forecast starts 08:30; the NY shape starts 09:30.\nKeep three reference frames explicit: phase prose; the full-session formal Narrow/order/close-position code; and location within prior NY BBOX. A rising recovery can stay below BBOX. An early extension can fail, be reclaimed or be reversed in a later phase. Apply formal thresholds only with sufficient exact evidence. Full-day labels and later outcomes are available only after their recorded deadlines.\nLondon L05 is the 03:00–04:00 IB 0.5 extension: upper=IBH+0.5×IB width, lower=IBL−0.5×IB width. This anchor differs from SessionPath full-box range multiples. Preserve touch, completed-close return and endpoint/regain distinctions.\nSource examples below quote Day review Q. Each original screenshot broadly agrees with the narrative; exact formal tags and OHLC were not revalidated. Learn the phase sequence and reference-frame distinctions, and describe the current attached chart from its own evidence.\n2022-01-04 CLG2022, source row 3: “Prior NY recovered. Asia tested above BBOX and returned inside; London dipped then expanded upward. The first upper extension rejected but was reclaimed before08:30. NY expanded higher and finished above the old BBOX.”\n2022-01-07 CLG2022, source row 6: “Asia extended above the old BBOX. London recovered from an early dip but its upside extension did not persist. Selling accelerated into NY; NY traded below the old BBOX and closed just inside its lower edge.”\n2022-01-20 CLH2022, source row 15: “Prior NY ended weak after an upside reversal. NTA and Asia traded below the old low; Asia recovered to the BBOX midpoint before fading. London rotated around the lower edge, made upside extensions and returned to IB. NY rallied above the old high, then reversed through the range and closed below the old low.”\n2022-01-21 CLH2022, source row 16: “Prior NY sold off sharply and weakness continued through NTA. Asia made an early low then recovered. London remained below the prior BBOX and neither0.5 extension was reached by08:30. LTN reclaimed the lower BBOX area; NY retested below, then recovered and balanced inside its lower quarter.”\nJan 7 endpoint caution: the screenshot includes a 16:00-open candle below the old low, while the source inside-close label uses the preceding completed candle. Keep that endpoint distinction unresolved when the required close is unreadable. Assign the 08:30–09:30 selloff to LTN.\nCurrent columns: H/I Asia IB/after-IB; J/K London IB/after-IB; L/M NY IB/after-IB; Q daily story; R formal phase combination; S BBOX endpoint sequence; T timed event tags. Use these headers when an older Researchguide column letter differs.";
