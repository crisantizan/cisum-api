import joi from '@hapi/joi';
import { UserLogin } from '@/modules/user/user.type';

/** joi user login schema */
export const userLoginSchema = joi.object<UserLogin>({
  password: joi.string().required().min(10),
  email: joi
    .string()
    .email()
    .required(),
});
