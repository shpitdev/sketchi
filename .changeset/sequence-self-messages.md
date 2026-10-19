---
"@sketchi/cli": patch
---

Sequence diagrams accept self-messages: a message whose source is its target, such as an identity provider validating credentials or a service retrying. It draws as a loop out of the participant's lifeline and back on its own row, with its label clear of the lifeline, and a self-call returns into a short nested activation bar. Self-messages never open or answer a call between participants. Diagrams without self-messages render exactly as before.
