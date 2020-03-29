import { Tedis } from 'tedis';
import { EnvService } from './env.service';

export class RedisService extends Tedis {
  private static instance: RedisService;

  constructor() {
    if (typeof RedisService.instance !== 'undefined') {
      return RedisService.instance;
    }

    const { host, redisPort } = new EnvService();

    super({
      host,
      port: redisPort,
    });

    RedisService.instance = this;

    return this;
  }

  /** generate the user key to get his token */
  public generateUserkey(userId: string) {
    return { redisUserKey: `userKey${userId}` };
  }
}
