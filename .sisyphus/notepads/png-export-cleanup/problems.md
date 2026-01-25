# Problems - PNG Export Cleanup

## Unresolved Blockers

### [2026-01-25] Task 7: Human Visual Review Required

**Status:** BLOCKED - Requires human verification

**What Needs Review:**
Task 7 requires manual visual inspection of PNG outputs to verify quality. This cannot be automated.

**PNG Files Available for Review:**

**Latest Test Runs (Post-Cleanup):**
1. `visual-grading_2026-01-25_06-53-19/` (most recent)
   - architecture-diagram.png
   - simple-flowchart.png
   - decision-tree.png

2. `optimization_2026-01-25_06-53-18/` (most recent)
   - Multiple diagram types (flowchart, architecture, decision-tree)
   - 9 PNG files generated

**Quality Criteria to Verify:**
- [ ] No browser chrome/headers visible at top of images
- [ ] Text is crisp and readable (not pixelated or blurry)
- [ ] White background (not transparent or other color)
- [ ] Shapes properly rendered with visible borders
- [ ] Arrows connect properly between shapes
- [ ] Proper padding around diagram content

**How to Review:**
1. Open PNGs in Finder or image viewer
2. Check each criterion above
3. Compare quality to baseline outputs in `optimization_2026-01-24_17-30-14/`
4. Document any visual issues found

**Expected Result:**
All PNGs should look identical to baseline since we only:
- Deleted unused files (no impact on rendering)
- Added NEW remote exporter (tests don't use it yet)
- Local exporter unchanged

**Next Steps:**
- Human reviews PNGs
- If issues found: document in issues.md (DO NOT FIX in this plan)
- If all good: mark Task 7 complete
- Then plan is 100% complete
