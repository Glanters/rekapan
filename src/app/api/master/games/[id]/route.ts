import { ValidationError } from '@/server/errors';
import { deleteGame, updateGame } from '@/server/games/service';
import { UpdateGameSchema } from '@/server/games/schema';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

function gameId(params: Record<string, string | string[]>): string {
  const id = params['id'];
  if (typeof id !== 'string') {
    throw new ValidationError('A game id is required.');
  }
  return id;
}

/** PATCH /api/master/games/:id */
export const PATCH = route({
  permission: 'game.update',
  bodySchema: UpdateGameSchema,
  handler: async ({ access, body, params }) =>
    ok(await updateGame(access, gameId(params), body), { message: 'Game diperbarui.' }),
});

/**
 * DELETE /api/master/games/:id
 *
 * Soft delete: the column leaves the Turnover grid, the figures already
 * recorded against it stay readable. `TurnoverValue.game` is `onDelete:
 * Restrict`, so a hard delete would be refused anyway.
 */
export const DELETE = route({
  permission: 'game.delete',
  handler: async ({ access, params }) =>
    ok(await deleteGame(access, gameId(params)), { message: 'Game dihapus.' }),
});
