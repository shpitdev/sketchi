---
"@sketchi/cli": patch
---

A generate request that doesn't name its diagram kind now gets the rules of only the kinds it could mean, instead of every kind's. On 76 such requests, 76 came back as diagrams instead of 72, and 75 were the right kind instead of 71. Each used about 70% fewer input tokens; choosing the kind adds about 0.2 s.
