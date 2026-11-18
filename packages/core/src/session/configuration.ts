import type {
  CompactionProfile,
  ModelConfig,
  ReasoningEffort,
  Session,
} from "@easycode/schema"

import {
  COMPACTION_PROFILE_MISSING_MESSAGE,
  COMPACTION_PROFILE_REQUIRED_MESSAGE,
  type CompactionProfileService,
} from "../compaction-profile/index.js"
import {
  MODEL_CONFIG_MISSING_MESSAGE,
  MODEL_CONFIG_REQUIRED_MESSAGE,
  REASONING_EFFORT_UNSUPPORTED_MESSAGE,
  type ModelConfigService,
} from "../model-config/index.js"

export interface SessionConfigurationServices {
  modelConfigs: ModelConfigService
  compactionProfiles: CompactionProfileService
}

export interface ResolvedSessionConfiguration {
  modelConfig: ModelConfig
  compactionProfile: CompactionProfile
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

  if (!session.compactionProfileID) throw new Error(COMPACTION_PROFILE_REQUIRED_MESSAGE)
  const compactionProfile = await services.compactionProfiles.get(session.compactionProfileID)
  if (!compactionProfile) throw new Error(COMPACTION_PROFILE_MISSING_MESSAGE)

  if (modelConfig.supportedReasoningEfforts.length === 0) {
    if (session.reasoningEffort !== undefined) {
      throw new Error(REASONING_EFFORT_UNSUPPORTED_MESSAGE)
    }
    return { modelConfig, compactionProfile }
  }

  if (
    session.reasoningEffort !== undefined &&
    !modelConfig.supportedReasoningEfforts.includes(session.reasoningEffort)
  ) {
    throw new Error(REASONING_EFFORT_UNSUPPORTED_MESSAGE)
  }
  return { modelConfig, compactionProfile, reasoningEffort: session.reasoningEffort }
}

/**
 * 校验一套可直接发起模型调用的完整会话配置。
 */
export const resolveSessionConfiguration = async (
  session: Session,
  services: SessionConfigurationServices,
): Promise<ResolvedSessionConfiguration> => resolveSessionSelection(session, services)
