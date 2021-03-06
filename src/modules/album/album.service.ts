import { Service } from '@/services';
import { mongo } from 'mongoose';
import { AlbumCreate } from './album.type';
import { AlbumModel, ArtistModel, SongModel } from '@/models';
import { MulterFile, PaginationAlbumOptions } from '@/typings/shared.typing';
import { removeAsset } from '@/helpers/multer.helper';
import { HttpStatus } from '@/common/enums';
import {
  objectIsEmpty,
  isEquals,
  mergeObject,
  removeUndefinedProps,
} from '@/helpers/service.helper';
import { cloudService } from '@/services/cloudinary.service';
import { CloudHelper } from '@/helpers/cloudinary.helper';
import { getMongooseSession } from '@/db/session';

export class AlbumService extends Service {
  constructor() {
    super();
  }

  /** get an album and his songs */
  public async getOne(albumId: string) {
    const [album, songs] = await Promise.all([
      AlbumModel.findById(albumId).lean(),
      // get his songs
      SongModel.find({ album: albumId })
        .select('id name number duration coverImage file')
        .lean(),
    ]);

    if (!album) {
      throw this.response(HttpStatus.NOT_FOUND, 'album not found');
    }

    return this.response(HttpStatus.OK, { ...album, songs });
  }

  /** search albums and paginate */
  public async searchAndPaginate({
    limit = 10,
    page = 1,
    byArtist,
    title,
    year,
  }: PaginationAlbumOptions) {
    // filter
    const query: any =
      !!byArtist || !!title || !!year
        ? {
            artist: byArtist,
            title: !!title ? new RegExp(title, 'i') : undefined,
            year,
          }
        : {};

    removeUndefinedProps(query);

    const albums = await AlbumModel.paginate(query, {
      page,
      limit,
      lean: true,
      select: 'id title year artist coverImage',
      sort: 'title',
      populate: { path: 'artist', select: 'id name' },
    });

    return this.response(HttpStatus.OK, albums);
  }

  /** create a new album */
  public async create(data: AlbumCreate, file: MulterFile) {
    // verify artist
    if (!(await ArtistModel.exists({ _id: data.artist }))) {
      throw this.response(HttpStatus.BAD_REQUEST, "the artist doesn't exist");
    }

    const albumId = new mongo.ObjectId().toHexString();

    if (!!file) {
      const result = await cloudService.uploader.upload(file.path, {
        folder: CloudHelper.genAlbumFolder(<string>data.artist, albumId),
      });

      data.coverImage = {
        id: result.public_id,
        // send croped image
        path: cloudService.url(result.public_id, {
          height: 350,
          width: 250,
          crop: 'fill',
          secure: true,
        }),
      };

      // remove local image
      await removeAsset(file.path);
    } else {
      data.coverImage = {
        id: null,
        path: null,
      };
    }

    const album = new AlbumModel({ _id: albumId, ...data });
    const newAlbum = await album.save();

    return this.response(HttpStatus.CREATED, newAlbum);
  }

  /** update album */
  public async update(
    albumId: string,
    data: Partial<AlbumCreate>,
    file?: MulterFile,
  ) {
    if (!file && objectIsEmpty(data)) {
      throw this.response(
        HttpStatus.BAD_REQUEST,
        'at least one field must be sent',
      );
    }

    const album = await AlbumModel.findById(albumId);

    // verify existence of album
    if (!album) {
      throw this.response(HttpStatus.NOT_FOUND, "album doesn't exists");
    }

    // if the same data has been sent
    if (!file && isEquals(data, album)) {
      throw this.response(
        HttpStatus.BAD_REQUEST,
        'the same data has been sent',
      );
    }

    const oldImageId = !objectIsEmpty(album.coverImage!)
      ? album.coverImage!.id
      : null;

    // add new image
    if (!!file) {
      const result = await cloudService.uploader.upload(file.path, {
        folder: CloudHelper.genAlbumFolder(String(album.artist), albumId),
      });

      data.coverImage = {
        id: result.public_id,
        // send croped image
        path: cloudService.url(result.public_id, {
          height: 350,
          width: 250,
          crop: 'fill',
          secure: true,
        }),
      };

      // remove local image
      await removeAsset(file.path);
    }

    await album.updateOne(data);

    // delete old image if other has been established
    !!oldImageId && (await cloudService.uploader.destroy(oldImageId));

    return this.response(HttpStatus.OK, mergeObject(data, album));
  }

  /** remove an album */
  public async remove(albumId: string) {
    const session = await getMongooseSession();
    session.startTransaction();

    try {
      const album = await AlbumModel.findByIdAndDelete(albumId).session(
        session,
      );

      if (!album) {
        throw this.response(HttpStatus.NOT_FOUND, "album doesn't exists");
      }

      // remove all songs
      await SongModel.deleteMany({ album: album._id }).session(session);
      // folder in cloudinary
      const folder = CloudHelper.genAlbumFolder(String(album.artist), albumId);

      // remove all files of this song
      await Promise.all([
        // audio
        cloudService.api.delete_resources_by_prefix(folder, {
          resource_type: 'video',
        }),
        // images
        cloudService.api.delete_resources_by_prefix(folder),
      ]);

      // remove empty folder
      await (cloudService.api as any).delete_folder(folder);

      await session.commitTransaction();

      return this.response(HttpStatus.OK, 'album removed successfully!');
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}
