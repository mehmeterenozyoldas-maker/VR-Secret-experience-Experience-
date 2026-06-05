# WebXR Teleportation System

To navigate the expansive Scandinavian gallery space naturally in VR, a controller-based teleportation system is required. Since continuous smooth locomotion can cause motion sickness in some users, teleportation offers a comfortable standard for WebXR applications.

## 1. Controller Inputs & UX
We utilize standard WebXR controllers with natural interaction mappings:
- **Teleportation (Squeeze/Grip):** Holding the secondary grip/squeeze activates the "aiming" mode for movement. This leaves the primary trigger free for UI interaction.
- **UI Interaction (Trigger/Select):** Used exclusively for pointing, selecting artifacts, and manipulating sliders.

## 2. Parabolic Bezier Aiming
Instead of drawing a rigid, straight line from the controller (which lacks depth perception and feels unnatural for movement targeting), we project a dynamic mathematical arc:
- While aiming, a **Quadratic Bezier Curve** is drawn from the controller's origin (`P0`) to the floor intersection point (`P2`).
- A control point (`P1`) is calculated halfway between origin and target, but elevated proportionally to the targeting distance. This creates a smooth, parabolic arc resembling a physical throw.
- The parabolic visualization provides clear spatial feedback, helping users understand exactly where they will land while bypassing obstacles in the line of sight.

## 3. Floor-Bound Raycasting
- The primary raycast strictly intersects the `teleportFloor` mesh.
- If it hits a valid floor area, a **teleportation marker** (a glowing neon ring) materializes at the intersection point, complementing the Bezier curve's terminus.

## 4. Locomotion Execution
When the grip/squeeze is released:
- If a valid target was locked, the root `cameraGroup` (the parent object holding the WebXR camera) is translated smoothly via an instant shift in world coordinates.
- We maintain the user's localized tracking height (usually ~1.6m) but calculate the exact X/Z shift relative to the physical controller and headset position, snapping them flawlessly to the target without sickening transitional sliding.
