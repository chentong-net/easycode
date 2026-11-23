import type {
  PromptProfile,
  ModelConfig,
  ReasoningEffort,
  Session,
} from "@easycode/schema"

import {
  PROMPT_PROFILE_MISSING_MESSAGE,
  PROMPT_PROFILE_REQUIRED_MESSAGE,
  type PromptProfileService,
} from "../prompt/index.js"
import {
  MODEL_CONFIG_MISSING_MESSAGE,
  MODEL_CONFIG_REQUIRED_MESSAGE,
  REASONING_EFFORT_UNSUPPORTED_MESSAGE,
  type ModelConfigService,
} from "../model-config/index.js"

export interface SessionConfigurationServices {
  modelConfigs: ModelConfigService
  promptProfiles: PromptProfileService
}

export interface ResolvedSessionConfiguration {
  modelConfig: ModelConfig
  promptProfile: PromptProfile
  reasoningEffort?: ReasoningEffort
}

/**
 * 解析会话当前选择的配置。
 *
 * reasoningEffort 可以为空；为空时不发送 reasoning_effort，使用模型默认行为。
 */
export const resolveSessionSelection = async (
  session: Session,
  services: SessionConfigurationServices,
): Promise<ResolvedSessionConfiguration> => {
  if (!session.modelConfigID) throw new Error(MODEL_CONFIG_REQUIRED_MESSAGE)
  const modelConfig = await services.modelConfigs.get(session.modelConfigID)
  if (!modelConfig) throw new Error(MODEL_CONFIG_MISSING_MESSAGE)

  if (!session.promptProfileID) throw new Error(PROMPT_PROFILE_REQUIRED_MESSAGE)
  const promptProfile = await services.promptProfiles.get(session.promptProfileID)
  if (!promptProfile) throw new Error(PROMPT_PROFILE_MISSING_MESSAGE)

  if (modelConfig.supportedReasoningEfforts.length === 0) {
    if (session.reasoningEffort !== undefined) {
      throw new Error(REASONING_EFFORT_UNSUPPORTED_MESSAGE)
    }
    return { modelConfig, promptProfile }
  }

  if (
    session.reasoningEffort !== undefined &&
    !modelConfig.supportedReasoningEfforts.includes(session.reasoningEffort)
  ) {
    throw new Error(REASONING_EFFORT_UNSUPPORTED_MESSAGE)
  }
  return { modelConfig, promptProfile, reasoningEffort: session.reasoningEffort }
}

/**
 * 校验一套可直接发起模型调用的完整会话配置。
 */
export const resolveSessionConfiguration = async (
  session: Session,
  services: SessionConfigurationServices,
): Promise<ResolvedSessionConfiguration> => resolveSessionSelection(session, services)
