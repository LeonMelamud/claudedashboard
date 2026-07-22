import type { TeamDto } from '@dash/shared';
import type { Db } from '../db/connection';

interface TeamRow {
  id: number;
  name: string;
  color: string;
  lead_user_id: number | null;
  member_count: number;
}

function toTeamDto(row: TeamRow): TeamDto {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    leadUserId: row.lead_user_id,
    memberCount: row.member_count,
  };
}

// Roster-scoped counting keeps departed employees (in_roster=0 after a roster
// sync) out of member counts. Sources without a roster (telemetry mode) only
// have observed users, all in_roster=0 — count every assigned user there.
const selectTeam = (rosterScoped: boolean): string => `
  SELECT t.id, t.name, t.color, t.lead_user_id,
         (SELECT COUNT(*) FROM users u
          WHERE u.team_id = t.id AND u.actor_type = 'user'${rosterScoped ? ' AND u.in_roster = 1' : ''}) AS member_count
  FROM teams t
`;

export class TeamRepo {
  constructor(
    private readonly db: Db,
    private readonly rosterScoped: boolean,
  ) {}

  list(): TeamDto[] {
    const rows = this.db
      .prepare(`${selectTeam(this.rosterScoped)} ORDER BY t.name COLLATE NOCASE`)
      .all() as TeamRow[];
    return rows.map(toTeamDto);
  }

  get(id: number): TeamDto | undefined {
    const row = this.db.prepare(`${selectTeam(this.rosterScoped)} WHERE t.id = ?`).get(id) as
      | TeamRow
      | undefined;
    return row ? toTeamDto(row) : undefined;
  }

  create(input: { name: string; color?: string; leadUserId?: number | null }): TeamDto {
    const res = this.db
      .prepare(`INSERT INTO teams (name, color, lead_user_id) VALUES (?, ?, ?)`)
      .run(input.name, input.color ?? '#6366f1', input.leadUserId ?? null);
    const team = this.get(Number(res.lastInsertRowid));
    if (!team) throw new Error('team insert failed');
    return team;
  }

  update(id: number, patch: { name?: string; color?: string; leadUserId?: number | null }): TeamDto | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db
      .prepare(`UPDATE teams SET name = ?, color = ?, lead_user_id = ? WHERE id = ?`)
      .run(
        patch.name ?? existing.name,
        patch.color ?? existing.color,
        patch.leadUserId === undefined ? existing.leadUserId : patch.leadUserId,
        id,
      );
    return this.get(id);
  }

  /** FK ON DELETE SET NULL clears members' team_id automatically. */
  delete(id: number): boolean {
    // explicit member unassignment for clarity (FK would also handle it)
    this.db.prepare(`UPDATE users SET team_id = NULL WHERE team_id = ?`).run(id);
    const res = this.db.prepare(`DELETE FROM teams WHERE id = ?`).run(id);
    return res.changes > 0;
  }
}
