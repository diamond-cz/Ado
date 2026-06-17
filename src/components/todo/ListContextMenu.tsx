// Right-click menu for the sidebar's user-defined lists.

import { useState } from "react";
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from "@mui/material";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import StarBorderRoundedIcon from "@mui/icons-material/StarBorderRounded";
import ArchiveRoundedIcon from "@mui/icons-material/ArchiveRounded";
import UnarchiveRoundedIcon from "@mui/icons-material/UnarchiveRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";

import { TodoEmoji } from "./TodoEmoji";

export interface FolderMoveOption {
  id: string | null;
  label: string;
  emoji?: string;
}

interface Props {
  anchor: { x: number; y: number };
  isDefault: boolean;
  isArchived: boolean;
  currentFolderId: string | null;
  folderOptions: FolderMoveOption[];
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onMoveToFolder: (folderId: string | null) => void;
}

export function ListContextMenu({
  anchor,
  isDefault,
  isArchived,
  currentFolderId,
  folderOptions,
  onClose,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  onSetDefault,
  onMoveToFolder,
}: Props) {
  const [folderAnchor, setFolderAnchor] = useState<HTMLElement | null>(null);

  const close = () => {
    setFolderAnchor(null);
    onClose();
  };

  return (
    <>
      <Menu
        open
        onClose={close}
        anchorReference="anchorPosition"
        anchorPosition={{ top: anchor.y, left: anchor.x }}
      >
        <MenuItem onClick={onEdit}>
          <ListItemIcon>
            <EditRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>编辑（名称 / Emoji）</ListItemText>
        </MenuItem>
        <MenuItem onClick={onSetDefault} disabled={isDefault || isArchived}>
          <ListItemIcon>
            {isDefault ? (
              <StarRoundedIcon fontSize="small" color="warning" />
            ) : (
              <StarBorderRoundedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            {isDefault ? "已是默认清单" : isArchived ? "归档清单不能设为默认" : "设为默认清单"}
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={isArchived ? onUnarchive : onArchive}>
          <ListItemIcon>
            {isArchived ? (
              <UnarchiveRoundedIcon fontSize="small" />
            ) : (
              <ArchiveRoundedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{isArchived ? "取消归档" : "归档清单"}</ListItemText>
        </MenuItem>
        <MenuItem onClick={(e) => setFolderAnchor(e.currentTarget)}>
          <ListItemIcon>
            <FolderRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>移动到文件夹</ListItemText>
          <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
        </MenuItem>
        <Divider />
        <MenuItem onClick={onDelete}>
          <ListItemIcon>
            <DeleteOutlineRoundedIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>删除清单</ListItemText>
        </MenuItem>
      </Menu>
      <Menu
        open={Boolean(folderAnchor)}
        anchorEl={folderAnchor}
        onClose={() => setFolderAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        {folderOptions.map((option) => (
          <MenuItem
            key={option.id ?? "none"}
            selected={(option.id ?? null) === currentFolderId}
            onClick={() => {
              onMoveToFolder(option.id);
              close();
            }}
          >
            <ListItemText>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {option.emoji && <TodoEmoji emoji={option.emoji} size={16} />}
                <span>{option.label}</span>
              </span>
            </ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
