"""Keyed randomness (SPEC 3.7).

Every draw comes from a fresh Philox generator keyed by (match_seed, purpose, frame, entity).
Nothing is drawn from a shared sequential stream, so an intervention that changes what happens in
the sim cannot shift any other draw: factual and counterfactual runs see common random numbers.
Callers draw a fixed shape per frame (one value per player) whether or not the value is used.
"""

from __future__ import annotations

import hashlib

import numpy as np


class KeyedRng:
    def __init__(self, seed: int, record: bool = False) -> None:
        self.seed = int(seed)
        # (entity, purpose, frame) -> drawn values, when recording is on (tests).
        self.recorded: dict[tuple[str, str, int], tuple[float, ...]] | None = {} if record else None

    def generator(self, purpose: str, frame: int, entity: str = "") -> np.random.Generator:
        digest = hashlib.blake2b(
            f"{self.seed}|{purpose}|{frame}|{entity}".encode(), digest_size=16
        ).digest()
        key = np.frombuffer(digest, dtype="<u8")
        return np.random.Generator(np.random.Philox(key=key))

    def uniform(
        self,
        purpose: str,
        frame: int,
        n: int,
        extra: tuple[int, ...] = (),
        entities: list[str] | None = None,
    ) -> np.ndarray:
        """U[0, 1) of shape (n, *extra); row i belongs to entities[i] when recording."""
        values = self.generator(purpose, frame).random((n, *extra))
        self._record(purpose, frame, values, entities)
        return values

    def normal(
        self, purpose: str, frame: int, n: int, entities: list[str] | None = None
    ) -> np.ndarray:
        values = self.generator(purpose, frame).standard_normal(n)
        self._record(purpose, frame, values, entities)
        return values

    def uniform_for(self, purpose: str, frame: int, entity: str) -> float:
        """One U[0, 1) draw that belongs to a single entity."""
        value = float(self.generator(purpose, frame, entity).random())
        if self.recorded is not None:
            self.recorded[(entity, purpose, frame)] = (value,)
        return value

    def _record(
        self, purpose: str, frame: int, values: np.ndarray, entities: list[str] | None
    ) -> None:
        if self.recorded is None or entities is None:
            return
        for entity, row in zip(entities, values, strict=True):
            self.recorded[(entity, purpose, frame)] = tuple(np.ravel(row).tolist())
