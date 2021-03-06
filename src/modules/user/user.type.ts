import { TimestampsFields, RoleType, Asset } from '@/typings/shared.typing';

/** data to create a new user */
export interface UserCreate {
  name: string;
  surname: string;
  password: string;
  email: string;
  role: RoleType;
  image?: Asset;
}

/** complete data of user */
export interface User extends UserCreate, TimestampsFields {}

/** user login data */
export interface UserLogin {
  email: string;
  password: string;
}
