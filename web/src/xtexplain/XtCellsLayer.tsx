// The from and to cells of the xT grid, on the tactical board, while an analyst or coach has the
// concrete xT explanation open (XtMoveExplain). Flat outlines and a faint fill: no blur, no flash.

import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { HALF_LENGTH, PITCH_L, PITCH_W } from "../tacticslab/metrics";
import { COLORS } from "../views/scene";
import { createStore, useStore } from "../store/store";
import type { BoardCell } from "./zones";

export const GRID = { cols: 16, rows: 12 }; // analytics/xt_grid.json "shape"

/** The cells on the board now; empty unless the concrete version is open. */
export const xtCells = createStore<{ cells: readonly BoardCell[] }>({ cells: [] });

const COLOR: Record<BoardCell["role"], string> = {
  from: COLORS.sight,
  to: COLORS.gold,
  alt: COLORS.muted,
};

const lie = -Math.PI / 2; // rotate a plane from XY into the pitch plane (XZ)

/** A cell's centre and corners in board metres: the attacking frame, turned for the team that
 * attacks -x (the grid is for a team attacking +x). */
export function cellBox(c: BoardCell, cols = GRID.cols, rows = GRID.rows) {
  const [w, h] = [PITCH_L / cols, PITCH_W / rows];
  const cx = c.sign * ((c.col + 0.5) * w - HALF_LENGTH);
  const cy = c.sign * ((c.row + 0.5) * h - PITCH_W / 2);
  return { cx, cy, w, h };
}

export function XtCellsLayer({ renderOrder }: { renderOrder: number }) {
  const cells = useStore(xtCells, (s) => s.cells);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [cells, invalidate]);
  return (
    <>
      {cells.map((c) => {
        const { cx, cy, w, h } = cellBox(c);
        const [x0, x1, z0, z1] = [cx - w / 2, cx + w / 2, -(cy - h / 2), -(cy + h / 2)];
        return (
          <group key={`${c.role}:${c.col}:${c.row}`}>
            <mesh position={[cx, 0, -cy]} rotation={[lie, 0, 0]} renderOrder={renderOrder}>
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial
                color={COLOR[c.role]}
                transparent
                opacity={0.22}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <Line
              points={[
                [x0, 0, z0],
                [x1, 0, z0],
                [x1, 0, z1],
                [x0, 0, z1],
                [x0, 0, z0],
              ]}
              color={COLOR[c.role]}
              lineWidth={2}
              transparent
              depthTest={false}
              renderOrder={renderOrder + 0.1}
            />
          </group>
        );
      })}
    </>
  );
}
