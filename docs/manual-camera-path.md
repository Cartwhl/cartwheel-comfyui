# Manual camera paths

Choose Moving → Manual path to edit a route directly in Scene. Select Start, End, or an adjustment point by clicking it, then drag its positive XYZ arrows. Only the selected point’s short curve handles are displayed.

## Shape and timing

A path can be straight or curved, with optional ease in/out. Add up to five adjustment points. Each adjustment has independent incoming and outgoing handle controls. Displayed handles have three times their visible reach in path evaluation, reducing clutter without limiting control.

Dragging a point moves its attached handle geometry with it. Path edits preserve the lens unless an explicit lens animation is enabled. Timeline block duration determines how quickly the same route is traversed; gaps hold the previous camera still.

## Aim and composition

Actor/body-part targeting follows the animated scene with the selected Camera follow strength. Choose a custom target marker for a stationary world-space aim point. Composition, lens, and tilt remain separate from path position.

Optional Custom start/end settings animate the selected block’s target, aim, composition, follow strength, lens, or tilt. These controls do not add arbitrary intermediate keyframes.

See the [stored recipe fields](../TECHNICAL_REFERENCE.md#manual-path-and-outer-recipe-fields) for serialization and the [timeline guide](camera-timeline.md) for splitting and transitions.
