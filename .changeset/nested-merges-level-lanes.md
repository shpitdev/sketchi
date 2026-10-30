---
"@sketchi/cli": patch
---

Two routing fixes. Lines that merge into one end now nest instead of crossing or winding round it. In patient intake flows with short questions, the self-pay branch used to run down past the routine-scheduling end and round into its far side, or cross the insurance branch on the way in; it now enters the end's free side facing it. In incident escalation flows, the line from Monitoring used to cross the fix check's "Yes" branch into the resolution; both now enter its side, Monitoring's line outside the other. A swimlane diagram still longer than 2.4:1 after tightening now raises its thinnest lanes level with each other, never past its broadest lane, where that brings it within 2.4:1: the incident-response swimlane with short labels goes from 2.55:1 to 2.39:1.
