import type { IDBPDatabase } from 'idb';
import { newId, sha256Hex } from '@/lib/crypto';
import { addDays, dateStringOf, toIsoTimestamp } from '@/lib/date';
import type {
  Accent,
  ActivityAction,
  AttachmentKind,
  RepeatRule,
  SpaceRole,
  Visibility,
} from '@/domain/types';
import { DEMO_SPACE_ID, DEMO_USER_IDS } from '@/domain/types';
import type {
  AnniversaryRecord,
  AttachmentRecord,
  CapsuleContentRecord,
  CapsuleRecord,
  MemberRecord,
  MemoryRecord,
  OurverseDB,
  SpaceRecord,
  UserRecord,
} from './db';

export const DEMO_SEED_VERSION = 6;

export interface DemoAsset {
  key: string;
  mimeType: string;
  kind: AttachmentKind;
}

export const DEMO_ASSETS: DemoAsset[] = [
  { key: 'sea-sunset.jpg', mimeType: 'image/jpeg', kind: 'image' },
  { key: 'rain-street.webp', mimeType: 'image/webp', kind: 'image' },
  { key: 'mountain-stars.png', mimeType: 'image/png', kind: 'image' },
  { key: 'night-train.jpg', mimeType: 'image/jpeg', kind: 'image' },
  { key: 'room-tone.mp3', mimeType: 'audio/mpeg', kind: 'audio' },
  { key: 'balcony-moon.webm', mimeType: 'video/webm', kind: 'video' },
];

export type DemoAssetLoader = (key: string) => Promise<Blob | null>;

export interface SeedResult {
  memories: number;
  attachments: number;
}

interface SeedMemory {
  title: string;
  bodyMd: string;
  daysAgo: number;
  time: string | null;
  author: 'a' | 'b';
  visibility: Visibility;
  tags: string[];
  location: string | null;
  assets: string[];
}

/**
 * All fixtures below are explicitly fictional (DEMO). They exist to exercise
 * the product end-to-end; no real personal material is shipped in the repo.
 */
const SEED_MEMORIES: SeedMemory[] = [
  {
    title: '海边的第一场日落',
    bodyMd:
      '风把外套吹得鼓起来，我们沿着海岸线一直走到灯亮。\n\n**那天的海是灰蓝色的**，太阳落下去的时候，整片水面安静了一瞬。谁都没说话，只是站着。\n\n回程的公交上，你说下次要带一副更好的相机。',
    daysAgo: 12,
    time: '19:42',
    author: 'a',
    visibility: 'shared',
    tags: ['海', '旅行', '日落'],
    location: '青岛 · 金沙滩',
    assets: ['sea-sunset.jpg'],
  },
  {
    title: '雨夜里的那家面馆',
    bodyMd:
      '雨大得像有人在天上倒水，我们躲进巷子里一间只有四张桌子的小店。\n\n老板把最后一碗热汤推过来的时候，玻璃上全是雾气。你用手指在雾里画了一个歪歪扭扭的圆。\n\n那碗面其实有点咸，但那天晚上很好。',
    daysAgo: 34,
    time: '21:15',
    author: 'b',
    visibility: 'shared',
    tags: ['日常', '雨', '夜晚'],
    location: '老城区 · 巷口面馆',
    assets: ['rain-street.webp'],
  },
  {
    title: '凌晨四点的山顶',
    bodyMd:
      '为了看日出，我们在夜里爬了三个小时。\n\n山顶冷得超出预期，两个人裹在同一件外套里，看星星一点点被天光吃掉。\n\n日出那一刻，我说了句很蠢的话：「原来值得的东西都这么难。」你笑到停不下来。',
    daysAgo: 58,
    time: '05:26',
    author: 'a',
    visibility: 'shared',
    tags: ['山', '旅行', '日出', '夜晚'],
    location: '泰山',
    assets: ['mountain-stars.png'],
  },
  {
    title: '第一次坐夜车',
    bodyMd:
      '硬卧的车厢里灯一直没关。你在下铺翻来覆去，最后爬上来和我挤在一起看窗外。\n\n经过一片没有名字的湖时，月亮正好掉在水面上。\n\n- 车票：两张\n- 零食：一袋橘子\n- 睡着的次数：零',
    daysAgo: 93,
    time: '23:48',
    author: 'b',
    visibility: 'shared',
    tags: ['旅行', '夜晚', '第一次'],
    location: '夜行列车',
    assets: ['night-train.jpg'],
  },
  {
    title: '第一次一起看电影',
    bodyMd:
      '老电影院只有一间厅，座椅是深红色的。电影放到一半，后排有人轻轻睡着了。\n\n散场以后下起小雨，我们绕了远路回去。',
    daysAgo: 140,
    time: '20:05',
    author: 'b',
    visibility: 'shared',
    tags: ['电影', '第一次', '夜晚'],
    location: '老电影院',
    assets: [],
  },
  {
    title: '一起录下的房间声音',
    bodyMd:
      '下午三点，房间里有水壶烧开的声音、楼下小孩的笑声，还有你翻书的声音。\n\n我们决定把它录下来。什么都没说，只是让这段日常自己待着。\n\n以后听到这段，应该会想起这个很普通的下午。',
    daysAgo: 120,
    time: '15:07',
    author: 'a',
    visibility: 'shared',
    tags: ['声音', '日常'],
    location: '家',
    assets: ['room-tone.mp3'],
  },
  {
    title: '阳台上的月亮',
    bodyMd:
      '月亮升得很快，云走过去的时候它像在呼吸。\n\n我们架起三脚架，拍了一段并不完美的延时。画面偶尔抖，但那就是当时的样子。',
    daysAgo: 151,
    time: '22:31',
    author: 'b',
    visibility: 'shared',
    tags: ['影像', '夜晚', '家'],
    location: '阳台',
    assets: ['balcony-moon.webm'],
  },
  {
    title: '厨房里的第一次手忙脚乱',
    bodyMd:
      '菜谱写「少许盐」，我们理解成了「一大勺」。\n\n最后端上来的汤咸得像海水，两个人一边喝水一边笑。下次会好一点的。',
    daysAgo: 176,
    time: '18:52',
    author: 'a',
    visibility: 'shared',
    tags: ['厨房', '日常', '第一次'],
    location: '家',
    assets: [],
  },
  {
    title: '三月的那场雨',
    bodyMd:
      '同一条街，同一把伞。雨下得很耐心，我们走了很久也没有到目的地，好像本来也不着急。',
    daysAgo: 208,
    time: null,
    author: 'b',
    visibility: 'shared',
    tags: ['雨', '日常'],
    location: '街角',
    assets: [],
  },
  {
    title: '搬家那天',
    bodyMd:
      '纸箱堆到快碰到天花板。第一件拆开的东西是那盏旧台灯，插上电的时候它闪了两下，然后亮了。\n\n新地址的窗外有一棵树。',
    daysAgo: 232,
    time: '16:20',
    author: 'a',
    visibility: 'shared',
    tags: ['搬家', '家'],
    location: '新家',
    assets: [],
  },
  {
    title: '写给自己的话',
    bodyMd:
      '有些话还没有找到合适的时机说出口。\n\n先放在这里。等哪天平静下来，再决定要不要拿出来给你看。',
    daysAgo: 275,
    time: '23:06',
    author: 'a',
    visibility: 'private',
    tags: ['心事'],
    location: null,
    assets: [],
  },
  {
    title: '海边的草稿',
    bodyMd:
      '关于那天海边，我写了一半的段落。\n\n等想清楚结尾，再把它放进共同的记忆里。',
    daysAgo: 315,
    time: '22:14',
    author: 'b',
    visibility: 'private',
    tags: ['心事', '海'],
    location: null,
    assets: [],
  },
  {
    title: '我们认识的第一天',
    bodyMd:
      '谁也没有想到，一次很普通的见面会变成后来的一切。\n\n只记得那天的天气不错，你说了一句我到现在还记得的话。',
    daysAgo: 372,
    time: '14:00',
    author: 'a',
    visibility: 'shared',
    tags: ['纪念日', '第一次'],
    location: '城南的咖啡馆',
    assets: [],
  },
];

const SEED_USERS: UserRecord[] = [
  {
    id: DEMO_USER_IDS.a,
    email: 'linwu@demo.ourverse.local',
    displayName: '林雾',
  },
  {
    id: DEMO_USER_IDS.b,
    email: 'jiangzhao@demo.ourverse.local',
    displayName: '江照',
  },
  {
    id: DEMO_USER_IDS.third,
    email: 'guest@demo.ourverse.local',
    displayName: '演示访客',
  },
];

function dateFor(now: Date, daysAgo: number): string {
  return dateStringOf(addDays(now, -daysAgo));
}

function shiftedYearlyDate(now: Date, daysAhead: number): string {
  return dateStringOf(addDays(now, daysAhead - 365));
}

interface SeedAnniversary {
  name: string;
  date: string;
  repeat: RepeatRule;
  visibility: Visibility;
  note: string | null;
  author: 'a' | 'b';
}

function buildAnniversaries(now: Date): SeedAnniversary[] {
  return [
    {
      name: '初次见面',
      date: shiftedYearlyDate(now, 23),
      repeat: 'yearly',
      visibility: 'shared',
      note: '那天下午在城南的咖啡馆，天气很好。',
      author: 'a',
    },
    {
      name: '第一次一起看海',
      date: shiftedYearlyDate(now, 61),
      repeat: 'yearly',
      visibility: 'shared',
      note: null,
      author: 'b',
    },
    {
      name: '第一次远行',
      date: dateFor(now, 210),
      repeat: 'once',
      visibility: 'shared',
      note: '已经过去的日子，也会被记住。',
      author: 'a',
    },
  ];
}

interface SeedCapsule {
  title: string;
  bodyMd: string;
  opensInDays: number;
  visibility: Visibility;
  author: 'a' | 'b';
}

const SEED_CAPSULES: SeedCapsule[] = [
  {
    title: '给半年后的我们',
    bodyMd:
      '写这封信的时候，窗外刚下过雨。\n\n如果你们现在正读到它，希望搬家的箱子已经拆完了，希望那棵树还在。\n\n也希望对你们来说，普通的日子还是值得记录的。',
    opensInDays: -3,
    visibility: 'shared',
    author: 'a',
  },
  {
    title: '搬家之前不要打开',
    bodyMd:
      '这里面写的是我搬进新家第一天的感受。\n\n如果你提前打开了……那也没关系，只是少了一点等待的乐趣。',
    opensInDays: 37,
    visibility: 'shared',
    author: 'b',
  },
  {
    title: '只写给自己的未来',
    bodyMd:
      '这是一封只属于我的信。等到那一天，如果我还记得为什么写下它，就说明有些东西没有变。',
    opensInDays: 180,
    visibility: 'private',
    author: 'a',
  },
];

export async function loadDemoAssets(
  resolve: (key: string) => string | undefined,
): Promise<Map<string, Blob>> {
  const loaded = new Map<string, Blob>();
  await Promise.all(
    DEMO_ASSETS.map(async (asset) => {
      const url = resolve(asset.key);
      if (!url) return;
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        loaded.set(asset.key, await response.blob());
      } catch {
        // Demo assets are optional; a missing file must not block seeding text data.
      }
    }),
  );
  return loaded;
}

function makeUserRecords(): UserRecord[] {
  return SEED_USERS.map((user) => ({ ...user }));
}

function makeMember(
  spaceId: string,
  userId: string,
  role: SpaceRole,
  joinedAt: string,
): MemberRecord {
  return { id: newId('member'), spaceId, userId, role, joinedAt };
}

/**
 * Writes the fictional demo world. Assets are loaded before the transaction
 * begins because IndexedDB transactions auto-close while awaiting network I/O.
 */
export async function writeDemoSeed(
  db: IDBPDatabase<OurverseDB>,
  now: Date,
  assets: Map<string, Blob>,
): Promise<SeedResult> {
  const spaceId = DEMO_SPACE_ID;
  const nowIso = now.toISOString();
  const space: SpaceRecord = {
    id: spaceId,
    displayName: '双人星球',
    createdBy: DEMO_USER_IDS.a,
    createdAt: nowIso,
    relationshipStartAt: dateFor(now, 372),
    motto: '把故事留在星光里。',
    accent: 'violet' satisfies Accent,
  };

  const members: MemberRecord[] = [
    makeMember(spaceId, DEMO_USER_IDS.a, 'owner', nowIso),
    makeMember(spaceId, DEMO_USER_IDS.b, 'member', nowIso),
  ];

  const memories: MemoryRecord[] = [];
  const attachments: AttachmentRecord[] = [];
  const activity: { id: string; spaceId: string; actorId: string; action: ActivityAction; targetId: string | null; createdAt: string }[] = [];

  for (const [index, seed] of SEED_MEMORIES.entries()) {
    const occurredOn = dateFor(now, seed.daysAgo);
    const occurredAt = toIsoTimestamp(occurredOn, seed.time);
    const memoryId = `demo-memory-${String(index + 1).padStart(2, '0')}`;
    const authorId = seed.author === 'a' ? DEMO_USER_IDS.a : DEMO_USER_IDS.b;
    memories.push({
      id: memoryId,
      spaceId,
      authorId,
      title: seed.title,
      bodyMd: seed.bodyMd,
      occurredOn,
      occurredTime: seed.time,
      occurredAt,
      visibility: seed.visibility,
      locationLabel: seed.location,
      tags: seed.tags,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      deletedAt: null,
    });

    for (const assetKey of seed.assets) {
      const definition = DEMO_ASSETS.find((asset) => asset.key === assetKey);
      const blob = assets.get(assetKey);
      if (!definition || !blob) continue;
      const attachmentId = newId('attachment');
      attachments.push({
        id: attachmentId,
        spaceId,
        memoryId,
        storagePath: `${spaceId}/${memoryId}/${attachmentId}-${assetKey}`,
        fileName: assetKey,
        mimeType: definition.mimeType,
        byteSize: blob.size,
        sha256: await sha256Hex(blob),
        kind: definition.kind,
        createdAt: occurredAt,
        data: await blob.arrayBuffer(),
      });
    }

    activity.push({
      id: newId('activity'),
      spaceId,
      actorId: authorId,
      action: 'memory.created',
      targetId: memoryId,
      createdAt: occurredAt,
    });
  }

  const anniversaries: AnniversaryRecord[] = buildAnniversaries(now).map((seed) => {
    const authorId = seed.author === 'a' ? DEMO_USER_IDS.a : DEMO_USER_IDS.b;
    return {
      id: newId('anniversary'),
      spaceId,
      authorId,
      name: seed.name,
      date: seed.date,
      repeat: seed.repeat,
      visibility: seed.visibility,
      note: seed.note,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  const capsules: CapsuleRecord[] = [];
  const capsuleContents: CapsuleContentRecord[] = [];
  for (const seed of SEED_CAPSULES) {
    const authorId = seed.author === 'a' ? DEMO_USER_IDS.a : DEMO_USER_IDS.b;
    const opensAt = addDays(now, seed.opensInDays);
    const capsuleId = newId('capsule');
    capsules.push({
      id: capsuleId,
      spaceId,
      authorId,
      title: seed.title,
      opensAt: opensAt.toISOString(),
      visibility: seed.visibility,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    capsuleContents.push({
      capsuleId,
      bodyMd: seed.bodyMd,
      bodyLength: seed.bodyMd.length,
      createdAt: nowIso,
    });
  }

  activity.push(
    {
      id: newId('activity'),
      spaceId,
      actorId: DEMO_USER_IDS.a,
      action: 'space.created',
      targetId: spaceId,
      createdAt: nowIso,
    },
    {
      id: newId('activity'),
      spaceId,
      actorId: DEMO_USER_IDS.b,
      action: 'member.joined',
      targetId: DEMO_USER_IDS.b,
      createdAt: nowIso,
    },
  );

  const tx = db.transaction(
    [
      'users',
      'spaces',
      'members',
      'memories',
      'attachments',
      'anniversaries',
      'capsules',
      'capsuleContents',
      'activity',
      'preferences',
      'meta',
    ],
    'readwrite',
  );

  await Promise.all([
    ...makeUserRecords().map((user) => tx.objectStore('users').put(user)),
    tx.objectStore('spaces').put(space),
    ...members.map((member) => tx.objectStore('members').put(member)),
    ...memories.map((memory) => tx.objectStore('memories').put(memory)),
    ...attachments.map((attachment) => tx.objectStore('attachments').put(attachment)),
    ...anniversaries.map((anniversary) => tx.objectStore('anniversaries').put(anniversary)),
    ...capsules.map((capsule) => tx.objectStore('capsules').put(capsule)),
    ...capsuleContents.map((content) => tx.objectStore('capsuleContents').put(content)),
    ...activity.map((entry) => tx.objectStore('activity').put(entry)),
    tx.objectStore('preferences').put({
      userId: DEMO_USER_IDS.a,
      aiEnabled: false,
      consentAt: null,
      updatedAt: nowIso,
    }),
    tx.objectStore('preferences').put({
      userId: DEMO_USER_IDS.b,
      aiEnabled: false,
      consentAt: null,
      updatedAt: nowIso,
    }),
    tx.objectStore('meta').put({
      key: 'seed',
      value: { version: DEMO_SEED_VERSION, seededAt: nowIso },
    }),
  ]);

  await tx.done;

  return { memories: memories.length, attachments: attachments.length };
}
