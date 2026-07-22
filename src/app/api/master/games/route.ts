import { createGame, listGames } from '@/server/games/service';
import { CreateGameSchema } from '@/server/games/schema';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * Turnover game master data.
 *
 * A game is a Turnover column, so creating one here widens every Turnover
 * report at once. `TurnoverGame` is not site-scoped: the column set is shared
 * across sites so their reports stay comparable.
 */

/** GET /api/master/games */
export const GET = route({
  permission: 'game.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const games = await listGames(access, {
      search: params.get('search') ?? undefined,
      // The master-data screen manages inactive games too, so it asks for them
      // explicitly; the Turnover grid, which only renders live columns, does not.
      includeInactive: params.get('includeInactive') === 'true',
    });

    return ok({ games });
  },
});

/** POST /api/master/games */
export const POST = route({
  permission: 'game.create',
  bodySchema: CreateGameSchema,
  handler: async ({ access, body }) => {
    const result = await createGame(access, body);

    // The restore case is reported, not glossed over: the operator asked to
    // create a game and instead got an existing one back, along with whatever
    // history was attached to it. Silently succeeding would hide that the
    // Turnover table just regained a column full of old figures.
    return ok(result.game, {
      status: result.restored ? 200 : 201,
      message: result.restored
        ? result.reattachedValues > 0
          ? `Game "${result.game.code}" dipulihkan beserta ${result.reattachedValues.toLocaleString('id-ID')} nilai turnover yang sudah tercatat.`
          : `Game "${result.game.code}" dipulihkan dari data yang sebelumnya dihapus.`
        : 'Game dibuat.',
    });
  },
});
