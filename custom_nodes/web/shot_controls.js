// UI choices map to the existing versioned recipe. Legacy recipes keep their
// math until a user explicitly changes their camera type or subject selection.
export function subjectSelection(p, available) {
  if (p.selection && p.selection !== "legacy") return p.selection;
  if (p.actors.length <= 1) return "single";
  return p.actors.length === available.length && available.every((id) => p.actors.includes(id)) ? "all" : "selected";
}
export function cameraBehavior(settings) {
  if (settings.mode === "history") return "history";
  if (settings.mode === "bookends") return settings.manual_path?.source_static ? "static" : "move";
  const p = settings.preset;
  if (p.behavior && p.behavior !== "legacy") return p.behavior;
  if (p.composition === "pov" || ["track_subjects", "follow", "lead", "alongside"].includes(p.movement))
    return "follow";
  return p.movement === "fixed" && p.aim_behavior !== "track" ? "static" : "move";
}
export function selectSubjects(p, choice, available, selected = p.actors) {
  p.target_mode='actors';p.aim_source='live';p.tracking_mode='auto';
  p.selection = choice;
  p.actors =
    choice === "all"
      ? available.slice()
      : choice === "single"
        ? [selected[0] ?? available[0]]
        : selected.filter((id) => available.includes(id));
  if (!p.actors.length) throw new Error("Select at least one actor to frame.");
  if (p.actors.length > 1 || !["ots", "pov", "detail"].includes(p.composition))
    p.composition = p.actors.length > 1 ? "group" : "single";
  if (!p.actors.includes(p.reference_actor)) p.reference_actor = p.actors[0];
  if (p.composition === "ots" && p.actors.includes(p.foreground_actor))
    p.foreground_actor = available.find((id) => !p.actors.includes(id));
}
export function selectBehavior(p, behavior) {
  p.behavior = behavior;
  p.start_time = 0;
  p.end_time = 0;
  if (behavior === "static") {
    p.movement = "fixed";
    p.aim_behavior = "fixed";
  }
  if (behavior === "move") {
    p.movement = "orbit";
    p.path_anchor = p.target_mode==='marker'?'fixed':'follow';
    p.aim_behavior = "target";
    p.direction = "left";
  }
  if (behavior === "follow") {
    p.movement = "track_subjects";
    p.aim_behavior = "track";
    p.framing_mode = "reference";
  }
}
export function selectViewpoint(p, view, available) {
  if (view !== "standard") selectSubjects(p, "single", available);
  p.composition = view === "standard" ? (p.actors.length > 1 ? "group" : "single") : view;
  if (view === "ots") {
    p.foreground_actor = available.find((id) => !p.actors.includes(id));
    if (p.foreground_actor == null) throw new Error("Over the shoulder needs two actors.");
  }
  if (view === "pov") selectBehavior(p, "follow");
  if (view === "detail") {
    p.shot = "close";
    p.aim = "head";
  }
}

// Explicit shot changes clear a stale frame-center override. Saved shots keep
// their original framing until the user chooses a size or restores it.
export function selectShot(p, shot) {
  p.shot = shot;
  p.framing_version = 2;
  p.focus_fill = 0;
  if (!(p.composition === "detail" && ["left_hand", "right_hand"].includes(p.aim))) p.aim = "auto";
}
export function restoreShotFraming(p) {
  selectShot(p, p.shot);
  p.padding = 1.06;
  if (!p.focus_point || p.focus_point === "legacy") p.focus_point = "auto";
  p.frame_reference = "auto";
  p.frame_x = .5; p.frame_y = 1/3;
  p.framing_scale = 1; p.focus_fill = 0;
  p.position_offset = [0, 0, 0];
  p.target_offset = [0, 0, 0];
}

// Retired free-form frame positions open on the nearest named composition.
export function nearestFramingReference(p) {
  if(p.frame_reference!=='custom') return;
  const points={center:[.5,.5],upper_third:[.5,1/3],lower_third:[.5,2/3],left_third:[1/3,.5],right_third:[2/3,.5],upper_left:[1/3,1/3],upper_right:[2/3,1/3],lower_left:[1/3,2/3],lower_right:[2/3,2/3]};
  p.frame_reference=Object.keys(points).reduce((best,key)=>Math.hypot(points[key][0]-p.frame_x,points[key][1]-p.frame_y)<Math.hypot(points[best][0]-p.frame_x,points[best][1]-p.frame_y)?key:best,'center');
}
