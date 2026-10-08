'use client';

import { useState, useEffect, useRef } from 'react';
import { Pencil, Check, ImagePlus, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { toast } from 'sonner';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';

/** Check whether avatar is a custom upload (data-URL) */
function isCustomAvatar(avatar: string) {
  return avatar.startsWith('data:');
}

/** Max uploaded image size before we reject */
const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB

const FILE_INPUT_ID = 'user-avatar-upload';

export function UserProfileCard() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHydrated(true); // eslint-disable-line react-hooks/set-state-in-effect -- Store hydration on mount
  }, []);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  const displayName = nickname || t('profile.defaultNickname');

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!hydrated) {
    return (
      <Card className="p-5 !gap-0 shadow-none rounded-[6px] border border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-[6px] bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-16 rounded bg-muted animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 !gap-0 shadow-none rounded-[6px] border border-border bg-card">
      {/* File input — sr-only keeps it in the flow but invisible; label triggers it */}
      <input
        id={FILE_INPUT_ID}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleAvatarUpload}
      />

      {/* Row 1: Avatar + Name */}
      <div className="flex items-center gap-3.5">
        {/* Avatar — click to toggle picker */}
        <button
          onClick={() => setAvatarPickerOpen(!avatarPickerOpen)}
          className="shrink-0 group/avatar relative cursor-pointer"
        >
          <div className="size-11 rounded-[6px] bg-muted border border-border overflow-hidden transition-all group-hover/avatar:border-primary/60">
            <img src={avatar} alt="" className="size-full object-cover" />
          </div>
          <div className="absolute -bottom-1 -right-1 size-4 rounded-[4px] bg-background border border-border flex items-center justify-center">
            <ChevronDown
              className={cn(
                'size-2.5 text-muted-foreground transition-transform duration-200',
                avatarPickerOpen && 'rotate-180',
              )}
            />
          </div>
        </button>

        {/* Name */}
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={nameInputRef}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                onBlur={commitName}
                maxLength={20}
                placeholder={t('profile.defaultNickname')}
                className="flex-1 min-w-0 h-7 bg-transparent border-b border-primary text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
              />
              <button
                onClick={commitName}
                className="shrink-0 size-6 rounded-[4px] flex items-center justify-center text-primary hover:bg-primary/10 transition-colors"
              >
                <Check className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={startEditName}
              className="group/name flex items-center gap-1.5 cursor-pointer"
            >
              <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
              <Pencil className="size-3 text-muted-foreground/40 opacity-0 group-hover/name:opacity-100 transition-opacity" />
            </button>
          )}
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{t('profile.avatarHint')}</p>
        </div>
      </div>

      {/* Avatar picker — collapsible */}
      <AnimatePresence>
        {avatarPickerOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {/* p-1 gives breathing room so ring-offset / hover-scale aren't clipped */}
            <div className="pt-3 pb-1 px-1 flex items-center gap-1.5 flex-wrap">
              {AVATAR_OPTIONS.map((url) => (
                <button
                  key={url}
                  onClick={() => setAvatar(url)}
                  className={cn(
                    'size-8 rounded-[4px] overflow-hidden bg-muted border cursor-pointer transition-all duration-150',
                    'hover:scale-105 active:scale-95',
                    avatar === url
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border hover:border-slate-400 dark:hover:border-slate-600',
                  )}
                >
                  <img src={url} alt="" className="size-full" />
                </button>
              ))}

              {/* Upload — uses <label htmlFor> to natively trigger the file input */}
              <label
                htmlFor={FILE_INPUT_ID}
                className={cn(
                  'size-8 rounded-[4px] flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                  'hover:scale-105 active:scale-95',
                  isCustomAvatar(avatar)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground/60 hover:border-foreground/40',
                )}
                title={t('profile.uploadAvatar')}
              >
                <ImagePlus className="size-3.5" />
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bio input */}
      <Textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder={t('profile.bioPlaceholder')}
        maxLength={200}
        rows={3}
        className="mt-3 resize-none bg-background/50 min-h-[80px] rounded-[6px] border-border focus-visible:ring-1 focus-visible:ring-primary"
      />
    </Card>
  );
}
