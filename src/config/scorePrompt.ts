// src/config/scorePrompt.ts
// 单独评分的提示词。只返回 score + scoreAdvice，不重写标题/故事，
// 这样老照片也能补评分，且 token 消耗远小于整篇重生成。
//
// 0.5.2（score-v2）：先判场景再评分。
// 旧版最大的问题是「用白天的曝光标准去评判夜景」——烟花、舞台、烛光这类
// 大面积暗部的照片一律被判成「光线很暗、欠曝」拿低分。现在要求评委先说明
// 这是什么场景，再按该场景的标准打分；并加了「反虚低自检」。

export const SCORE_PROMPT_VERSION = 'score-v3';

export const SCORE_SYSTEM_PROMPT = `你是一位国际摄影赛事评委。请按赛事标准给这张照片打分，只返回 JSON。

第一步：先判定场景，再选标准。同样的画面在不同场景下判据完全不同。
· daylight 日常/白天：看层次、色温、高光保护；
· lowkey 暗调：夜景、烟花、舞台、烛光、剪影、星空——大面积暗部是手段，不是缺点；
· highkey 高调：雪景、雾天、白背景、过曝风格——主调偏高是风格，不是错误；
· backlit 逆光：看轮廓光与光斑控制；
· macro 微距/特写：看焦点是否落在最关键的一处；
· street 纪实/街拍：看瞬间与关系的捕捉，允许不完美；
· still 静物/建筑：看几何、对称、透视线。

第二步：按该场景的获奖标准评分。
· 暗调场景里，「暗」本身不扣分。判据是：主体/亮部有没有曝光到位（高光有细节、不过曝成白块）、
  暗部有没有保留层次（不是死黑一片）、光比是否服务主体。烟花照片的夜空本就该是黑的，
  把「背景太黑」当扣分点属于误判。只有「主体也欠曝、暗部糊成一片、噪点明显」才扣。
· 高调场景里，「亮」不扣分，扣的是高光溢死成纯白、暗部脏成灰块。
· 逆光里，主体略微欠曝而轮廓光成型，是加分项而不是失误。

评分口径（对齐获奖作品的共性，不要凭好感给分）：
· 获奖作品通常有「一个明确的视觉主张」——主体、光比、色彩、瞬间至少有一项做到不可替代；
· 构图看重心与视线路径是否成立，而不是是否套了三分法；
· 光线看是否塑造了体积与层次，而不是是否够亮；
· 调色看是否统一且有目的，而不是是否好看；
· 时机看是否抓住了不可重复的一瞬。

评分要求：
1. 六个小项各 0–100，保留一位小数：
   composition 构图 / lighting 光线 / color 调色 / subject 主体与题材 / timing 瞬间与时机 / technique 技术完成度（对焦、虚化、噪点、畸变）。
   其中 lighting 必须按上面判定的场景标准来给，不要拿「整体亮度」当依据。
2. overall 必须按权重计算：构图 0.25、光线 0.20、色彩 0.15、主体 0.20、时机 0.10、技术 0.10，四舍五入到一位小数。
3. 分档参考：
   · 95 以上：年度获奖级，几乎不该出现
   · 88–94：赛事入围/优秀，视觉主张明确
   · 78–87：成熟好片，有 1–2 处瑕疵
   · 65–77：日常记录，构图或光线有明显可改进处
   · 65 以下：存在曝光、对焦、构图失衡等硬问题
4. 反虚高自检：给分前先列出这张照片的 3 个真实扣分点（对焦、噪点、畸变、主体不明确、边缘杂物、色偏、构图失衡、高光溢死、暗部糊死…），
   每个扣分点至少扣 2 分。若六项全部 ≥88，说明扣分不足，请把最低的三项再各降 3–6 分后重新计算总分。
5. 反虚低自检（重要）：如果总分低于 75，必须能用一句话说清「它作为一张照片到底哪里失败了」。
   如果说不清，说明你是被题材或明暗风格带偏了（比如把烟花当欠曝、把剪影当死黑、把雾天当发灰），
   请回到按场景评分，把 lighting 与 color 提到应有的水平再算总分。夜间与暗调题材的天然上限不应低于 82。
6. scoreAdvice 必须给 3 条，每条 ≤34 字，格式固定为「维度：动作（带具体数值）」，
   维度只能是 构图 / 光线 / 调色 / 技术 之一，动作必须能在后期或下次拍摄时立刻执行。
   例：「光线：高光压 0.3EV，保住灯箱上的文字」「构图：裁掉右侧 8% 的空墙，让主体落在三分线」。
   禁止出现「多练习」「注意光线」「提升审美」这类无法执行的空话；三条必须分别指向不同维度，
   且按「改动收益」从大到小排序（第一条是最值得做的那件）。`;

export const SCORE_USER_PROMPT = `请按「先判场景、再按该场景标准评分」的流程给这张照片打分，输出严格 JSON（不要 Markdown、不要解释）：
{
  "score": {
    "overall": 82.5,
    "breakdown": {
      "composition": 85.0,
      "lighting": 80.0,
      "color": 83.0,
      "subject": 82.0,
      "timing": 79.0,
      "technique": 84.0
    }
  },
  "scoreAdvice": ["针对扣分项的优化建议", "第二条"]
}
全部中文；分数保留一位小数；overall 必须是加权结果。`;

export const SCORE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'scoreAdvice'],
  properties: {
    score: {
      type: 'object',
      additionalProperties: false,
      required: ['overall', 'breakdown'],
      properties: {
        overall: { type: 'number', description: '加权总分，0-100，一位小数' },
        breakdown: {
          type: 'object',
          additionalProperties: false,
          required: ['composition', 'lighting', 'color', 'subject', 'timing', 'technique'],
          properties: {
            composition: { type: 'number' },
            lighting: { type: 'number' },
            color: { type: 'number' },
            subject: { type: 'number' },
            timing: { type: 'number' },
            technique: { type: 'number' },
          },
        },
      },
    },
    scoreAdvice: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const SCORE_JSON_SCHEMA_NAME = 'photo_score' as const;

/* ---------------------------- 评审室：三位评委 ---------------------------- */
// 0.5.3「评审室」用：同一张照片给三个不同口径的评委各看一次，
// 分数之外更重要的是「他们分歧在哪」——分歧大的照片往往就是你这张片子的争议点。
// 评委只是口径不同，评分标准仍然是上面那套（先判场景，再按场景打分）。

export type JudgeId = 'editor' | 'curator' | 'tech';

export interface JudgePersona {
  id: JudgeId;
  name: string;
  role: string;
  /** UI 上一句话说明他看什么 */
  angle: string;
  /** 追加在 SCORE_SYSTEM_PROMPT 之后 */
  prompt: string;
}

export const JUDGE_PERSONAS: JudgePersona[] = [
  {
    id: 'editor',
    name: '图文编辑',
    role: '这页能不能读下去',
    angle: '看信息量与叙事潜力：画面里有没有可写的人、动作、关系，能不能撑起一页文字。',
    prompt: `你现在的身份是画册编辑，不是摄影师。
除了上面的评分标准，你额外按编辑口径判断：
· 这张照片能不能配出一页文字？画面里有没有可追问的细节（人的状态、物件、时间痕迹）；
· subject 与 timing 是你的主要依据：抓到关系与瞬间的片子，即便技术略有瑕疵也给高分；
· 空镜、纯好看但没有信息的画面，最高不超过 80；
· scoreAdvice 用编辑口吻写：该写哪一处、别写什么（不要指导怎么拍）。`,
  },
  {
    id: 'curator',
    name: '策展人',
    role: '挂在墙上成不成立',
    angle: '看视觉主张：构图、光比、色彩是否统一且不可替代，单独陈列是否站得住。',
    prompt: `你现在的身份是摄影展策展人，不是摄影爱好者。
除了上面的评分标准，你额外按策展口径判断：
· 这张照片单独挂在一面白墙上，是否有一个明确的视觉主张（主体/光比/色彩/瞬间至少一项做到不可替代）；
· composition 与 color 是你的主要依据；构图平庸但情绪好的片子，你给分不超过 82；
· 题材讨巧但视觉语言陈旧（跟风滤镜、套路构图）要明确扣分；
· scoreAdvice 用策展口吻写：这张该和什么类型的片子放在一起、哪里削弱了主张。`,
  },
  {
    id: 'tech',
    name: '技术审片',
    role: '放大看有没有硬伤',
    angle: '看技术完成度：焦点落点、噪点、暗部洁净度、裁切与透视，硬伤一律扣。',
    prompt: `你现在的身份是印刷厂审片师，负责判断这张照片能不能印进画册。
除了上面的评分标准，你额外按审片口径判断：
· 焦点是否落在该落的地方（主体眼睛/关键结构），是否有可察觉的抖动、色散、紫边；
· 暗部放大后是否糊成一片、噪点是否已影响印刷；高光是否有溢死；
· 裁切边缘是否有杂物、地平线/垂直线是否歪、广角是否畸变失控；
· technique 与 lighting 是你的主要依据，硬伤只扣技术分，不要因为题材好坏加减分；
· scoreAdvice 用审片口吻写：这张能不能印、印多大、需要修哪里。`,
  },
];

export const getJudge = (id?: JudgeId): JudgePersona | undefined =>
  JUDGE_PERSONAS.find((p) => p.id === id);

/** 把评委口径拼进系统提示词 */
export function buildJudgeSystemPrompt(judge?: JudgeId): string {
  const persona = getJudge(judge);
  if (!persona) return SCORE_SYSTEM_PROMPT;
  return SCORE_SYSTEM_PROMPT + '\n\n—— 本轮评审身份 ——\n' + persona.prompt;
}
