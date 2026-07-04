import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Floorplan {
  id: string;
  name: string;
  imagePath: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  zoom: number;
}

function fromRow(row: any): Floorplan {
  return {
    id: row.id,
    name: row.name,
    imagePath: row.image_path,
    cropX: row.crop_x,
    cropY: row.crop_y,
    cropWidth: row.crop_width,
    cropHeight: row.crop_height,
    rotation: row.rotation,
    zoom: row.zoom
  };
}

export function createFloorplanRepository(db: Database.Database) {
  return {
    list(): Floorplan[] {
      return db.prepare('SELECT * FROM floorplans ORDER BY name').all().map(fromRow);
    },
    get(id: string): Floorplan | undefined {
      const row = db.prepare('SELECT * FROM floorplans WHERE id = ?').get(id);
      return row ? fromRow(row) : undefined;
    },
    add(input: { name: string; imagePath: string }): Floorplan {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO floorplans (id, name, image_path, crop_x, crop_y, crop_width, crop_height, rotation, zoom) VALUES (?, ?, ?, 0, 0, 1, 1, 0, 1)'
      ).run(id, input.name, input.imagePath);
      return {
        id, name: input.name, imagePath: input.imagePath,
        cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, rotation: 0, zoom: 1
      };
    },
    update(id: string, patch: Partial<Omit<Floorplan, 'id' | 'imagePath'>>): Floorplan {
      const current = this.get(id);
      if (!current) throw new Error(`floorplan ${id} not found`);
      const next = { ...current, ...patch };
      db.prepare(
        'UPDATE floorplans SET name = ?, crop_x = ?, crop_y = ?, crop_width = ?, crop_height = ?, rotation = ?, zoom = ? WHERE id = ?'
      ).run(next.name, next.cropX, next.cropY, next.cropWidth, next.cropHeight, next.rotation, next.zoom, id);
      return next;
    }
  };
}
