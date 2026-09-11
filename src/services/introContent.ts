import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { compressImageIfNeeded } from '../utils/imageCompression';
import { getAdminSession } from './adminAuth';

// 타임투밋 공통 행사소개 콘텐츠(참가자 /event-info, /events/:eventId/info
// 하단에 붙는 텍스트/이미지 갤러리). 행사별로 따로 저장하지 않는다 - 관리자가
// "행사소개 관리"에서 한 번만 작성하면 모든 행사 소개 페이지에 그대로
// 쓰인다. 행사명/날짜/장소/가격/인원 같은 운영 정보는 여기서 다루지 않고
// events 테이블/useOperationalData가 그대로 유일한 source of truth다.
export type IntroSectionType = 'text' | 'gallery';

export interface IntroImage {
  caption: string;
  displayOrder: number;
  id: string;
  imageUrl: string | null;
}

export interface IntroSection {
  content: string | null;
  displayOrder: number;
  id: string;
  images: IntroImage[];
  isVisible: boolean;
  sectionType: IntroSectionType;
  title: string | null;
}

// 연결된 실제 행사가 없을 때(홈에서 특정 신청 흐름 없이 들어오는 경우 등)
// 쓰는 fallback 값. 실제 행사 데이터가 있으면 이 값들은 전혀 쓰이지 않는다.
export interface IntroDefaultInfo {
  eventDate: string | null;
  endTime: string | null;
  femaleCapacity: number | null;
  femalePrice: number | null;
  location: string | null;
  maleCapacity: number | null;
  malePrice: number | null;
  startTime: string | null;
  title: string | null;
}

export interface IntroContentPayload {
  defaultInfo: IntroDefaultInfo;
  sections: IntroSection[];
}

const emptyDefaultInfo: IntroDefaultInfo = {
  eventDate: null,
  endTime: null,
  femaleCapacity: null,
  femalePrice: null,
  location: null,
  maleCapacity: null,
  malePrice: null,
  startTime: null,
  title: null,
};

function mapDefaultInfo(row: unknown): IntroDefaultInfo {
  if (!row || typeof row !== 'object') return emptyDefaultInfo;
  const value = row as Record<string, unknown>;
  return {
    eventDate: (value.eventDate as string | null) ?? null,
    endTime: (value.endTime as string | null) ?? null,
    femaleCapacity: value.femaleCapacity == null ? null : Number(value.femaleCapacity),
    femalePrice: value.femalePrice == null ? null : Number(value.femalePrice),
    location: (value.location as string | null) ?? null,
    maleCapacity: value.maleCapacity == null ? null : Number(value.maleCapacity),
    malePrice: value.malePrice == null ? null : Number(value.malePrice),
    startTime: (value.startTime as string | null) ?? null,
    title: (value.title as string | null) ?? null,
  };
}

function mapSections(rows: unknown): IntroSection[] {
  return ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    content: (row.content as string | null) ?? null,
    displayOrder: Number(row.displayOrder ?? 0),
    id: row.id as string,
    images: ((row.images ?? []) as Array<Record<string, unknown>>).map((image) => ({
      caption: (image.caption as string) ?? '',
      displayOrder: Number(image.displayOrder ?? 0),
      id: image.id as string,
      imageUrl: (image.imageUrl as string | null) ?? null,
    })),
    isVisible: Boolean(row.isVisible),
    sectionType: row.sectionType as IntroSectionType,
    title: (row.title as string | null) ?? null,
  }));
}

async function extractFunctionErrorMessage(error: unknown, data: unknown, fallback: string) {
  const body = data as { message?: string } | null;
  if (body?.message) return body.message;
  if (error instanceof FunctionsHttpError) {
    try {
      const parsed = await error.context.json();
      if (parsed?.message) return String(parsed.message);
    } catch {
      // keep fallback
    }
  }
  return fallback;
}

// 참가자 화면(공개) - is_visible=true 섹션만 내려온다.
export async function fetchPublicIntroContent(): Promise<IntroContentPayload> {
  if (!supabase) return { defaultInfo: emptyDefaultInfo, sections: [] };
  const { data, error } = await supabase.functions.invoke('intro-content', { body: {} });
  if (error || data?.ok !== true) return { defaultInfo: emptyDefaultInfo, sections: [] };
  return { defaultInfo: mapDefaultInfo(data.defaultInfo), sections: mapSections(data.sections) };
}

// 관리자 편집/미리보기 - 숨김 섹션도 포함해 전부 내려온다.
export async function fetchAdminIntroContent(): Promise<IntroContentPayload> {
  if (!supabase) return { defaultInfo: emptyDefaultInfo, sections: [] };
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('intro-content', {
    body: { sessionToken: adminSession.token },
  });
  if (error || data?.ok !== true) {
    throw new Error(await extractFunctionErrorMessage(error, data, '행사소개를 불러오지 못했습니다.'));
  }
  return { defaultInfo: mapDefaultInfo(data.defaultInfo), sections: mapSections(data.sections) };
}

export async function updateIntroDefaultInfo(payload: {
  eventDate: string | null;
  endTime: string | null;
  femaleCapacity: number | null;
  femalePrice: number | null;
  location: string | null;
  maleCapacity: number | null;
  malePrice: number | null;
  startTime: string | null;
  title: string | null;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('update_intro_default_info_for_session', {
    end_time_value: payload.endTime,
    event_date_value: payload.eventDate,
    female_capacity_value: payload.femaleCapacity,
    female_price_value: payload.femalePrice,
    location_value: payload.location,
    male_capacity_value: payload.maleCapacity,
    male_price_value: payload.malePrice,
    session_token: adminSession.token,
    start_time_value: payload.startTime,
    title_value: payload.title,
  });
  if (error) throw new Error(error.message || '기본 행사 정보를 저장하지 못했습니다.');
}

export async function createIntroSection(sectionType: IntroSectionType, title: string, content: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('create_intro_section_for_session', {
    content_value: content,
    section_type_value: sectionType,
    session_token: adminSession.token,
    title_value: title,
  });
  if (error) throw new Error(error.message || '섹션을 추가하지 못했습니다.');
  return data as string;
}

export async function updateIntroSection(sectionId: string, title: string, content: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('update_intro_section_for_session', {
    content_value: content,
    section_id_value: sectionId,
    session_token: adminSession.token,
    title_value: title,
  });
  if (error) throw new Error(error.message || '섹션을 저장하지 못했습니다.');
}

export async function setIntroSectionVisible(sectionId: string, isVisible: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('set_intro_section_visible_for_session', {
    is_visible_value: isVisible,
    section_id_value: sectionId,
    session_token: adminSession.token,
  });
  if (error) throw new Error(error.message || '노출 상태를 변경하지 못했습니다.');
}

export async function reorderIntroSections(orderedIds: string[]): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('reorder_intro_sections_for_session', {
    ordered_ids: orderedIds,
    session_token: adminSession.token,
  });
  if (error) throw new Error(error.message || '순서를 변경하지 못했습니다.');
}

export async function deleteIntroSection(sectionId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('delete_intro_section_for_session', {
    section_id_value: sectionId,
    session_token: adminSession.token,
  });
  if (error) throw new Error(error.message || '섹션을 삭제하지 못했습니다.');
  await cleanupStoragePaths((data as string[] | null) ?? []);
}

export async function reorderIntroImages(sectionId: string, orderedIds: string[]): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('reorder_intro_images_for_session', {
    ordered_ids: orderedIds,
    section_id_value: sectionId,
    session_token: adminSession.token,
  });
  if (error) throw new Error(error.message || '이미지 순서를 변경하지 못했습니다.');
}

export async function updateIntroImageCaption(imageId: string, caption: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('update_intro_image_caption_for_session', {
    caption_value: caption,
    image_id_value: imageId,
    session_token: adminSession.token,
  });
  if (error) throw new Error(error.message || '캡션을 저장하지 못했습니다.');
}

export async function deleteIntroImage(imageId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('delete_intro_image_for_session', {
    image_id_value: imageId,
    session_token: adminSession.token,
  });
  if (error) throw new Error(error.message || '이미지를 삭제하지 못했습니다.');
  if (data) await cleanupStoragePaths([data as string]);
}

export async function uploadIntroImage(
  sectionId: string,
  file: File,
  caption = '',
  replaceImageId?: string,
): Promise<IntroImage> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const resized = await compressImageIfNeeded(file);
  const photo = await fileToPayload(resized);

  const { data, error } = await supabase.functions.invoke('upload-intro-image', {
    body: { caption, photo, replaceImageId, sectionId, sessionToken: adminSession.token },
  });
  if (error || data?.ok !== true) {
    throw new Error(await extractFunctionErrorMessage(error, data, '이미지 업로드에 실패했습니다.'));
  }

  const row = data.image as Record<string, unknown>;
  return {
    caption: (row.caption as string) ?? '',
    displayOrder: Number(row.displayOrder ?? 0),
    id: row.id as string,
    imageUrl: (row.imageUrl as string | null) ?? null,
  };
}

// 실패해도 콘텐츠 저장/삭제 자체는 이미 끝났으니 조용히 넘어가는
// best-effort 정리(이 프로젝트의 다른 Storage cleanup들과 동일 패턴).
async function cleanupStoragePaths(paths: string[]) {
  if (!supabase || paths.length === 0) return;
  const adminSession = getAdminSession();
  if (!adminSession) return;
  try {
    await supabase.functions.invoke('admin-delete-storage-objects', {
      body: { paths, sessionToken: adminSession.token },
    });
  } catch {
    // best-effort
  }
}

async function fileToPayload(file: File) {
  const dataUrl = await blobToDataUrl(file);
  const [, base64 = ''] = dataUrl.split(',');
  return {
    base64,
    contentType: file.type || 'application/octet-stream',
    fileName: file.name,
  };
}

const fileReadTimeoutMs = 15000;

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => {
      reader.abort();
      reject(new Error('파일을 읽는 데 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요.'));
    }, fileReadTimeoutMs);
    reader.onload = () => {
      clearTimeout(timer);
      resolve(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      clearTimeout(timer);
      reject(reader.error ?? new Error('파일을 읽을 수 없습니다.'));
    };
    reader.readAsDataURL(blob);
  });
}
