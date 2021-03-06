import { UserDocument, UserModel } from '@/models';
import { UserCreate, UserLogin } from './user.type';
import { EncryptService } from '@/services/encrypt.service';
import { HttpStatus } from '@/common/enums/http-status.enum';
import { errorFieldObject } from '@/helpers/shared.helper';
import { ServiceResponse } from '@/typings/shared.typing';
import { Service } from '@/services/service';
import { JwtService } from '@/services/jwt.service';
import { RedisService } from '@/services/redis.service';
import { Role } from '@/common/enums';
import { removeAsset, getAssetPath } from '@/helpers/multer.helper';
import { getMongooseSession } from '@/db/session';
import { isEquals, mergeObject, objectIsEmpty } from '@/helpers/service.helper';
import { cloudService } from '@/services/cloudinary.service';
import { CloudFolder } from '@/helpers/cloudinary.helper';

export class UserService extends Service {
  constructor(
    private readonly jwtService = new JwtService(),
    private readonly redisService = new RedisService(),
  ) {
    super();
  }

  /** who i'am */
  public async whoami(userId: string) {
    const user = await UserModel.findById(userId);

    if (!user) {
      throw this.response(HttpStatus.NOT_FOUND, {
        login: true,
        message: 'token is corrupt, please login again',
      });
    }

    return this.response(HttpStatus.OK, user);
  }

  /** get all users */
  public async getAll(): Promise<ServiceResponse<UserDocument[]>> {
    const users = await UserModel.find();
    return this.response(HttpStatus.OK, users);
  }

  /** get one user */
  public async getOne(id: string) {
    const user = await UserModel.findById(id);

    if (!user) {
      throw this.response(HttpStatus.NOT_FOUND, 'user not found');
    }

    return this.response(HttpStatus.OK, user);
  }

  /** save a new user */
  public async save(data: UserCreate) {
    // verify si the new user is a admin
    if (data.role === 'ADMIN') {
      // count admin
      const quantity = await UserModel.count({ role: Role.ADMIN });

      if (quantity > 0) {
        throw this.response(
          HttpStatus.BAD_REQUEST,
          'the administrator type user already exists, there should only be one',
        );
      }

      // allow create admin
    }

    if (await this.emailExists(data.email)) {
      throw this.response(
        HttpStatus.BAD_REQUEST,
        errorFieldObject('email', 'email passed already exists'),
      );
    }

    // set image property as null
    const model = new UserModel({ ...data, image: { id: null, path: null } });
    const user = await model.save();

    return this.response(HttpStatus.CREATED, user);
  }

  /** validate existence of the email passed */
  private async emailExists(email: string) {
    return await UserModel.exists({ email });
  }

  /** user login */
  public async login({ email, password }: UserLogin) {
    const user = await UserModel.findOne({ email });

    if (!user || !EncryptService.compareHash(password, user.password)) {
      throw this.response(HttpStatus.FORBIDDEN, 'incorrect credentials');
    }

    // create token for 15 days
    const token = await this.jwtService.create(
      { id: user.id, role: user.role },
      '15d',
    );

    const { redisUserKey } = this.redisService.generateUserkey(user.id);

    // save token in redis
    await this.redisService.set(redisUserKey, token);

    return this.response(HttpStatus.OK, { user, token });
  }

  /** user logout */
  public async logout(userId: string) {
    const { redisUserKey } = this.redisService.generateUserkey(userId);

    // remove from the redis
    await this.redisService.del(redisUserKey);

    return this.response(HttpStatus.OK, 'logout sucessfully');
  }

  /** user update */
  public async update(
    userId: string,
    data: Partial<UserCreate>,
    file?: Express.Multer.File,
  ) {
    const session = await getMongooseSession();

    session.startTransaction();
    try {
      if (!Object.keys(data).length) {
        throw this.response(
          HttpStatus.BAD_REQUEST,
          'at least one field must be sent',
        );
      }
      const user = await UserModel.findById(userId);

      if (!user) {
        throw this.response(HttpStatus.NOT_FOUND, {
          login: true,
          message: 'token is corrupt, please login again',
        });
      }

      // if the same data has been sent
      if (!file && isEquals(data, user)) {
        throw this.response(
          HttpStatus.BAD_REQUEST,
          'the same data has been sent',
        );
      }

      // verify new email
      if (
        !!data.email &&
        user.email !== data.email &&
        (await this.emailExists(data.email))
      ) {
        throw this.response(
          HttpStatus.BAD_REQUEST,
          errorFieldObject('email', 'email passed already exists'),
        );
      }

      let oldImageId = !objectIsEmpty(user.image!) ? user.image!.id : null;

      // add new image
      if (!!file) {
        const result = await cloudService.uploader.upload(file.path, {
          folder: CloudFolder.USERS,
        });

        // assign new image
        data.image = {
          id: result.public_id,
          // send croped image
          path: cloudService.url(result.public_id, {
            height: 150,
            width: 150,
            crop: 'fill',
            secure: true,
          }),
        };
      }

      // encrypt password
      if (!!data.password) {
        data.password = await EncryptService.createHash(data.password);
      }
      // update
      await user.updateOne(data).session(session);
      await session.commitTransaction();

      // delete old image of disk if other has been established
      if (!!oldImageId && !!file) {
        await cloudService.uploader.destroy(oldImageId);
      }

      !!file && removeAsset(file.path);

      return this.response(HttpStatus.OK, mergeObject(data, user));
    } catch (error) {
      await session.abortTransaction();
      if (!!file) {
        // remove image upladed
        await removeAsset(file.path);
      }
      throw error;
    } finally {
      session.endSession();
    }
  }
}
