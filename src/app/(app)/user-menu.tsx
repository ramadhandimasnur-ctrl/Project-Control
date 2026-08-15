'use client';

import { LogOut, User } from 'lucide-react';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="gap-2" />}
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initials || <User className="size-3" aria-hidden />}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{fullName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate font-medium">{fullName}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span>
          {globalRole === 'ADMIN' ? (
            <Badge variant="secondary" className="mt-2">
              Administrator organisasi
            </Badge>
          ) : null}
        </DropdownMenuLabel>
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
