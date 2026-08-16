'use client';

import { LogOut, User } from 'lucide-react';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { signOutAction } from '../(auth)/actions';

export function UserMenu({
  fullName,
  email,
  globalRole,
}: {
  fullName: string;
  email: string;
  globalRole: 'ADMIN' | 'MEMBER';
}) {
  const [pending, startTransition] = useTransition();

  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      {/*
        The name is repeated in the label rather than replaced by it: on a
        narrow screen the visible text is hidden and the button would otherwise
        announce itself as nothing but its initials.
      */}
      <DropdownMenuTrigger
        aria-label={`Menu akun ${fullName}`}
        render={<Button variant="ghost" size="sm" className="gap-2" />}
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initials || <User className="size-3" aria-hidden />}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{fullName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/*
          A plain header, not `DropdownMenuLabel`.

          That component renders Base UI's `Menu.GroupLabel`, which reads its
          group from context and throws when there is none — which is what this
          menu did on every click, because there was no `Menu.Group` around it.
          Wrapping one would have silenced the error while making a second,
          quieter claim: a group label is announced as the name of the items
          beneath it, so a screen reader would have introduced "Keluar" as
          belonging to a group called "Dimas Nur Ramadhan". This block is a
          heading that says who is signed in, so it is written as one.
        */}
        <div className="px-1.5 py-1">
          <span className="block truncate text-sm font-medium">{fullName}</span>
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
          {globalRole === 'ADMIN' ? (
            <Badge variant="secondary" className="mt-2">
              Administrator organisasi
            </Badge>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => {
              void signOutAction();
            });
          }}
        >
          <LogOut className="size-4" aria-hidden />
          {pending ? 'Keluar…' : 'Keluar'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
