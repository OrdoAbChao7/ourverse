import { z } from 'zod';
import { isValidDateString, isValidTimeString } from '@/lib/date';
import { VISIBILITIES } from './types';

export const visibilitySchema = z.enum(VISIBILITIES);

export const tagSchema = z
  .string()
  .trim()
  .min(1, '标签不能为空')
  .max(24, '单个标签最多 24 个字符');

export const memoryInputSchema = z.object({
  title: z.string().trim().min(1, '请为这一刻写一个标题').max(120, '标题最多 120 个字符'),
  bodyMd: z.string().max(20_000, '正文最多 20000 个字符').default(''),
  occurredOn: z.string().refine(isValidDateString, '请选择有效的日期'),
  occurredTime: z
    .string()
    .nullable()
    .refine((value) => value === null || isValidTimeString(value), '时间格式不正确'),
  visibility: visibilitySchema,
  locationLabel: z
    .string()
    .trim()
    .max(80, '地点最多 80 个字符')
    .transform((value) => (value ? value : null))
    .nullable(),
  tags: z.array(tagSchema).max(12, '最多添加 12 个标签'),
});

export type MemoryFormValues = z.input<typeof memoryInputSchema>;
export type ParsedMemoryInput = z.output<typeof memoryInputSchema>;

export const anniversaryInputSchema = z.object({
  name: z.string().trim().min(1, '给它一个名字').max(60, '名称最多 60 个字符'),
  date: z.string().refine(isValidDateString, '请选择有效的日期'),
  repeat: z.enum(['yearly', 'once']),
  visibility: visibilitySchema,
  note: z
    .string()
    .trim()
    .max(500, '备注最多 500 个字符')
    .transform((value) => (value ? value : null))
    .nullable(),
});

export type AnniversaryFormValues = z.input<typeof anniversaryInputSchema>;

export const capsuleInputSchema = z.object({
  title: z.string().trim().min(1, '给这颗胶囊一个标题').max(120, '标题最多 120 个字符'),
  bodyMd: z.string().trim().min(1, '胶囊里总得装点什么').max(20_000, '内容最多 20000 个字符'),
  visibility: visibilitySchema,
});

export const capsuleScheduleSchema = z.object({
  opensAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), '请选择有效的开启时间')
    .refine((value) => Date.parse(value) > Date.now(), '开启时间必须在未来'),
});

export const spaceProfileSchema = z.object({
  displayName: z.string().trim().min(1, '空间需要一个名字').max(40, '名称最多 40 个字符'),
  motto: z.string().trim().max(60, '这句话最多 60 个字符').default(''),
});

export const inviteSchema = z.object({
  invitedEmail: z
    .string()
    .trim()
    .email('请输入有效的邮箱地址')
    .max(120)
    .optional()
    .or(z.literal('')),
  ttlHours: z.coerce.number().int().min(1).max(168).default(72),
});

export const askQuestionSchema = z
  .string()
  .trim()
  .min(2, '请至少输入两个字')
  .max(200, '问题最多 200 个字符');

export function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? '输入内容不完整。';
}
