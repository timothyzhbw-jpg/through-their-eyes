// Field markings and goals by IFAB Laws of the Game, Law 1 (SPEC 3.9), in metres: the numbers
// sim/laws.py uses. tests/test_pitch_geometry.py checks that the two agree and that no view draws a
// marking from its own literal.

export const LAW1 = {
  length: 105,
  width: 68,
  lineWidth: 0.12, // at most 12 cm; the posts and the bar are as wide
  goalWidth: 7.32, // between the inner edges of the posts
  goalHeight: 2.44, // from the ground to the lower edge of the crossbar
  postWidth: 0.12,
  goalAreaDepth: 5.5, // into the field, and out from the inside of each post
  penaltyAreaDepth: 16.5,
  penaltyMark: 11, // from the midpoint between the posts
  centreCircle: 9.15,
  penaltyArc: 9.15, // around the penalty mark, drawn outside the penalty area
  cornerArc: 1,
} as const;

const goalHalfWidth = LAW1.goalWidth / 2;
const postRadius = LAW1.postWidth / 2;

/** Derived distances (m), from the centre mark: x along the touchlines, y across. */
export const FIELD = {
  halfLength: LAW1.length / 2, // the outer edge of each goal line
  halfWidth: LAW1.width / 2, // the outer edge of each touchline
  goalHalfWidth,
  goalAreaHalfWidth: goalHalfWidth + LAW1.goalAreaDepth,
  penaltyAreaHalfWidth: goalHalfWidth + LAW1.penaltyAreaDepth,
  // Round posts standing on the goal line: their backs on its outer edge, inner edges 7.32 m apart.
  postRadius,
  postX: LAW1.length / 2 - postRadius,
  postY: goalHalfWidth + postRadius,
  barHeight: LAW1.goalHeight + postRadius, // the crossbar's centre
  // The penalty arc is the part of its circle beyond the penalty area: this far either side of
  // the line from the mark to the centre of the field.
  penaltyArcHalfAngle: Math.acos((LAW1.penaltyAreaDepth - LAW1.penaltyMark) / LAW1.penaltyArc),
};
