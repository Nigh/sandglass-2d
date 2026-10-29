import { RADIUS } from '../src/geometry.js';

const COLS = Math.ceil(224 / (2 * RADIUS));
const ROWS = Math.ceil(444 / (2 * RADIUS));
// Match physics.js linear-index neighbors, including its row-edge semantics.
const NEIGHBORS = [-1, 1, -COLS, COLS];

export class FixedBlockSupport {
  constructor(sand, blockSize = 8) {
    if (!Number.isInteger(blockSize) || blockSize < 1)
      throw new RangeError('Invalid block size');
    this.blockSize = blockSize;
    const size = COLS * ROWS;
    const blockCols = Math.ceil(COLS / blockSize);
    const blockRows = Math.ceil(ROWS / blockSize);
    this.blocks = [];
    this.blockOfCell = new Int32Array(size);
    this.labels = new Int32Array(size);
    this.wallMasks = new Uint8Array(size + 1);
    this.edgeHeads = new Int32Array(size + 1);
    this.edgeNext = new Int32Array(size * 4);
    this.reachable = new Uint8Array(size + 1);
    this.queue = new Int32Array(size);
    this.dirty = new Uint8Array(blockCols * blockRows);
    this.dirty.fill(1);
    this.stats = { updates: 0, rebuilds: 0, rebuiltCells: 0, graphNodes: 0 };

    for (let by = 0; by < blockRows; by++) {
      for (let bx = 0; bx < blockCols; bx++) {
        const block = {
          x0: bx * blockSize,
          x1: Math.min((bx + 1) * blockSize, COLS),
          y0: by * blockSize,
          y1: Math.min((by + 1) * blockSize, ROWS),
          nodes: []
        };
        const index = this.blocks.length;
        this.blocks.push(block);
        for (let y = block.y0; y < block.y1; y++)
          for (let x = block.x0; x < block.x1; x++)
            this.blockOfCell[y * COLS + x] = index;
      }
    }
  }

  touch(cellIndex) {
    this.dirty[this.blockOfCell[cellIndex]] = 1;
  }

  rebuild(sand, blockIndex) {
    const block = this.blocks[blockIndex];
    const { labels, queue, edgeHeads, edgeNext, wallMasks, blockOfCell } = this;
    block.nodes.length = 0;
    for (let y = block.y0; y < block.y1; y++)
      for (let x = block.x0; x < block.x1; x++) labels[y * COLS + x] = 0;

    for (let y = block.y0; y < block.y1; y++) {
      for (let x = block.x0; x < block.x1; x++) {
        const start = y * COLS + x;
        if (!sand.grid[start] || labels[start]) continue;
        // A cell-derived node ID stays independent of grain IDs and renumbering.
        const node = start + 1;
        block.nodes.push(node);
        labels[start] = node;
        edgeHeads[node] = -1;
        let mask = 0;
        let tail = 1;
        queue[0] = start;
        for (let q = 0; q < tail; q++) {
          const cell = queue[q];
          for (let direction = 0; direction < NEIGHBORS.length; direction++) {
            const next = cell + NEIGHBORS[direction];
            if (!sand.valid[next]) mask |= 1 << direction;
            if (next < 0 || next >= labels.length) continue;
            if (blockOfCell[next] !== blockIndex) {
              // Cache boundary cell pairs, not labels that a neighbor can replace.
              // Keep empty targets too: the adjacent block can later gain a grain.
              const edge = cell * 4 + direction;
              edgeNext[edge] = edgeHeads[node];
              edgeHeads[node] = edge;
            } else if (sand.grid[next] && !labels[next]) {
              labels[next] = node;
              queue[tail++] = next;
            }
          }
        }
        wallMasks[node] = mask;
      }
    }
    this.dirty[blockIndex] = 0;
    this.stats.rebuilds++;
    this.stats.rebuiltCells += (block.x1 - block.x0) * (block.y1 - block.y0);
  }

  update(sand, gx, gy) {
    this.stats.updates++;
    sand.grounded.fill(0);
    if (Math.hypot(gx, gy) === 0) return;

    for (let b = 0; b < this.blocks.length; b++)
      if (this.dirty[b]) this.rebuild(sand, b);

    const forward = Math.abs(gx) > Math.abs(gy) ? Math.sign(gx) : Math.sign(gy) * COLS;
    const rootBit = 1 << NEIGHBORS.indexOf(forward);
    const { reachable, queue, labels, edgeHeads, edgeNext, wallMasks } = this;
    reachable.fill(0);
    let tail = 0;
    // Re-seed from walls every query: detached cycles cannot support themselves.
    // ponytail: still scans the whole component graph and output, not active particles.
    for (const block of this.blocks) {
      this.stats.graphNodes += block.nodes.length;
      for (const node of block.nodes) {
        if (wallMasks[node] & rootBit) {
          reachable[node] = 1;
          queue[tail++] = node;
        }
      }
    }
    for (let q = 0; q < tail; q++) {
      const node = queue[q];
      for (let edge = edgeHeads[node]; edge !== -1; edge = edgeNext[edge]) {
        const next = labels[Math.floor(edge / 4) + NEIGHBORS[edge % 4]];
        if (next && !reachable[next]) {
          reachable[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    // Support is a pre-move snapshot; touch() only dirties the next update.
    for (let i = 0; i < sand.count; i++)
      sand.grounded[i] = reachable[labels[sand.cell[i]]];
  }
}
