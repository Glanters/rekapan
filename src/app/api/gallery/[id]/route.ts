import { ValidationError } from '@/server/errors';
import { deleteImage } from '@/server/gallery/service';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/** DELETE /api/gallery/:id — soft delete; the stored object is retained. */
export const DELETE = route({
  permission: 'gallery.delete',
  handler: async ({ access, params }) => {
    const id = params['id'];
    if (typeof id !== 'string') {
      throw new ValidationError('An image id is required.');
    }

    return ok(await deleteImage(access, id), { message: 'Gambar dihapus.' });
  },
});
