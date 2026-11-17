import {
  API_SUCCESS_CODE,
  API_SUCCESS_MESSAGE,
  ApiErrorCode,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "@easycode/protocol"

export const success = <T>(data: T): ApiSuccessResponse<T> => ({
  code: API_SUCCESS_CODE,
  message: API_SUCCESS_MESSAGE,
  data,
})

export const failure = (
  message: string,
  code: number = ApiErrorCode.generic,
): ApiErrorResponse => ({
  code,
  message,
})
