param(
    [Parameter(Mandatory = $true)]
    [string] $ExePath,

    [Parameter(Mandatory = $true)]
    [string] $IcoPath,

    [string] $Version = "1.0.0",
    [string] $ProductName = "Curationist",
    [string] $FileDescription = "Curationist - OBS Media & Preset Studio",
    [string] $CompanyName = "sorryneedboost.com",
    [string] $Copyright = "Copyright (C) 2026 sorryneedboost.com",
    [string] $OriginalFilename = "Curationist.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Target executable not found: $ExePath"
}
if (-not (Test-Path -LiteralPath $IcoPath)) {
    throw "Icon file not found: $IcoPath"
}

$exeFull = (Resolve-Path -LiteralPath $ExePath).Path
$icoFull = (Resolve-Path -LiteralPath $IcoPath).Path

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class PeResourceStamper
{
    private const int RT_ICON = 3;
    private const int RT_GROUP_ICON = 14;
    private const int RT_VERSION = 16;
    private const ushort LANG_EN_US = 1033; // 0x0409

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr BeginUpdateResourceW(string pFileName, [MarshalAs(UnmanagedType.Bool)] bool bDeleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool UpdateResourceW(
        IntPtr hUpdate,
        IntPtr lpType,
        IntPtr lpName,
        ushort wLanguage,
        byte[] lpData,
        uint cbData
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResourceW(IntPtr hUpdate, [MarshalAs(UnmanagedType.Bool)] bool fDiscard);

    private static IntPtr MakeIntResource(int id)
    {
        return new IntPtr(id);
    }

    public static void StampIconAndVersion(
        string exePath,
        string icoPath,
        string versionStr,
        string productName,
        string fileDescription,
        string companyName,
        string copyright,
        string originalFilename
    )
    {
        byte[] icoBytes = File.ReadAllBytes(icoPath);
        if (icoBytes.Length < 6)
            throw new InvalidDataException("Invalid ICO file (too short).");

        ushort reserved = BitConverter.ToUInt16(icoBytes, 0);
        ushort type = BitConverter.ToUInt16(icoBytes, 2);
        ushort count = BitConverter.ToUInt16(icoBytes, 4);
        if (reserved != 0 || type != 1 || count == 0)
            throw new InvalidDataException("Invalid ICO header.");

        // Build GRPICONDIR (6 + count * 14 bytes) and extract individual RT_ICON frames
        byte[] grpBytes = new byte[6 + count * 14];
        Buffer.BlockCopy(icoBytes, 0, grpBytes, 0, 6);

        var iconPayloads = new List<byte[]>(count);
        for (int i = 0; i < count; i++)
        {
            int srcOff = 6 + i * 16;
            int dstOff = 6 + i * 14;

            // Copy first 12 bytes of ICONDIRENTRY (Width..BytesInRes)
            Buffer.BlockCopy(icoBytes, srcOff, grpBytes, dstOff, 12);

            uint bytesInRes = BitConverter.ToUInt32(icoBytes, srcOff + 8);
            uint imgOffset = BitConverter.ToUInt32(icoBytes, srcOff + 12);
            if (imgOffset + bytesInRes > icoBytes.Length)
                throw new InvalidDataException("ICO frame bounds exceed file size.");

            ushort iconId = (ushort)(i + 1);
            byte[] idBytes = BitConverter.GetBytes(iconId);
            Buffer.BlockCopy(idBytes, 0, grpBytes, dstOff + 12, 2);

            byte[] frame = new byte[bytesInRes];
            Buffer.BlockCopy(icoBytes, (int)imgOffset, frame, 0, (int)bytesInRes);
            iconPayloads.Add(frame);
        }

        byte[] versionResource = BuildVersionInfo(
            versionStr,
            productName,
            fileDescription,
            companyName,
            copyright,
            originalFilename
        );

        IntPtr hUpdate = BeginUpdateResourceW(exePath, false);
        if (hUpdate == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "BeginUpdateResourceW failed.");

        bool success = false;
        try
        {
            // Electron ships with 4 RT_ICON frames (IDs 1..4); delete any leftover if new ICO has fewer than 4 frames
            for (int oldId = count + 1; oldId <= 4; oldId++)
            {
                UpdateResourceW(hUpdate, MakeIntResource(RT_ICON), MakeIntResource(oldId), LANG_EN_US, null, 0);
            }

            // Write each new RT_ICON frame (1..count)
            for (int i = 0; i < count; i++)
            {
                byte[] frame = iconPayloads[i];
                if (!UpdateResourceW(hUpdate, MakeIntResource(RT_ICON), MakeIntResource(i + 1), LANG_EN_US, frame, (uint)frame.Length))
                {
                    int err = Marshal.GetLastWin32Error();
                    throw new Win32Exception(err, "UpdateResourceW(RT_ICON #" + (i + 1) + ") failed with Win32 error " + err);
                }
            }

            // Write RT_GROUP_ICON (ID 1)
            if (!UpdateResourceW(hUpdate, MakeIntResource(RT_GROUP_ICON), MakeIntResource(1), LANG_EN_US, grpBytes, (uint)grpBytes.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateResourceW(RT_GROUP_ICON) failed.");

            // Write RT_VERSION (ID 1)
            if (!UpdateResourceW(hUpdate, MakeIntResource(RT_VERSION), MakeIntResource(1), LANG_EN_US, versionResource, (uint)versionResource.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateResourceW(RT_VERSION) failed.");

            success = true;
        }
        finally
        {
            if (!EndUpdateResourceW(hUpdate, !success))
            {
                if (success)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "EndUpdateResourceW failed.");
            }
        }
    }

    private static void Align4(MemoryStream ms)
    {
        while ((ms.Position & 3) != 0)
            ms.WriteByte(0);
    }

    private static byte[] BuildNode(ushort wType, string key, byte[] rawValue, bool valueIsTextChars, List<byte[]> children)
    {
        using (var ms = new MemoryStream())
        using (var bw = new BinaryWriter(ms, Encoding.Unicode, true))
        {
            bw.Write((ushort)0); // placeholder for wLength
            ushort wValueLength = 0;
            if (rawValue != null)
            {
                wValueLength = valueIsTextChars ? (ushort)(rawValue.Length / 2) : (ushort)rawValue.Length;
            }
            bw.Write(wValueLength);
            bw.Write(wType);

            byte[] keyBytes = Encoding.Unicode.GetBytes(key + "\0");
            bw.Write(keyBytes);
            Align4(ms);

            if (rawValue != null && rawValue.Length > 0)
            {
                bw.Write(rawValue);
            }

            if (children != null && children.Count > 0)
            {
                foreach (byte[] child in children)
                {
                    Align4(ms);
                    bw.Write(child);
                }
            }

            byte[] result = ms.ToArray();
            ushort totalLen = (ushort)result.Length;
            byte[] lenBytes = BitConverter.GetBytes(totalLen);
            result[0] = lenBytes[0];
            result[1] = lenBytes[1];
            return result;
        }
    }

    private static byte[] BuildStringEntry(string key, string val)
    {
        byte[] valBytes = Encoding.Unicode.GetBytes((val ?? "") + "\0");
        return BuildNode(1, key, valBytes, true, null);
    }

    private static byte[] BuildVersionInfo(
        string versionStr,
        string productName,
        string fileDescription,
        string companyName,
        string copyright,
        string originalFilename
    )
    {
        string[] parts = (versionStr ?? "1.0.0").Split('.');
        ushort p0 = 0, p1 = 0, p2 = 0, p3 = 0;
        ushort v1 = (parts.Length > 0 && ushort.TryParse(parts[0], out p0)) ? p0 : (ushort)1;
        ushort v2 = (parts.Length > 1 && ushort.TryParse(parts[1], out p1)) ? p1 : (ushort)0;
        ushort v3 = (parts.Length > 2 && ushort.TryParse(parts[2], out p2)) ? p2 : (ushort)0;
        ushort v4 = (parts.Length > 3 && ushort.TryParse(parts[3], out p3)) ? p3 : (ushort)0;
        string fourPart = string.Format("{0}.{1}.{2}.{3}", v1, v2, v3, v4);

        // VS_FIXEDFILEINFO (52 bytes)
        byte[] fixedInfo;
        using (var fms = new MemoryStream(52))
        using (var fbw = new BinaryWriter(fms))
        {
            fbw.Write((uint)0xFEEF04BD);                  // dwSignature
            fbw.Write((uint)0x00010000);                  // dwStrucVersion
            fbw.Write((uint)((v1 << 16) | v2));           // dwFileVersionMS
            fbw.Write((uint)((v3 << 16) | v4));           // dwFileVersionLS
            fbw.Write((uint)((v1 << 16) | v2));           // dwProductVersionMS
            fbw.Write((uint)((v3 << 16) | v4));           // dwProductVersionLS
            fbw.Write((uint)0x0000003F);                  // dwFileFlagsMask
            fbw.Write((uint)0x00000000);                  // dwFileFlags
            fbw.Write((uint)0x00040004);                  // dwFileOS = VOS_NT_WINDOWS32
            fbw.Write((uint)0x00000001);                  // dwFileType = VFT_APP
            fbw.Write((uint)0x00000000);                  // dwFileSubtype
            fbw.Write((uint)0x00000000);                  // dwFileDateMS
            fbw.Write((uint)0x00000000);                  // dwFileDateLS
            fixedInfo = fms.ToArray();
        }

        string internalName = Path.GetFileNameWithoutExtension(originalFilename);
        var stringEntries = new List<byte[]>
        {
            BuildStringEntry("CompanyName", companyName),
            BuildStringEntry("FileDescription", fileDescription),
            BuildStringEntry("FileVersion", fourPart),
            BuildStringEntry("InternalName", internalName),
            BuildStringEntry("LegalCopyright", copyright),
            BuildStringEntry("OriginalFilename", originalFilename),
            BuildStringEntry("ProductName", productName),
            BuildStringEntry("ProductVersion", fourPart)
        };

        byte[] stringTable = BuildNode(1, "040904B0", null, false, stringEntries);
        byte[] stringFileInfo = BuildNode(1, "StringFileInfo", null, false, new List<byte[]> { stringTable });

        byte[] translationVal = new byte[] { 0x09, 0x04, 0xB0, 0x04 }; // 0x0409 (en-US), 0x04B0 (1200 Unicode)
        byte[] varNode = BuildNode(0, "Translation", translationVal, false, null);
        byte[] varFileInfo = BuildNode(1, "VarFileInfo", null, false, new List<byte[]> { varNode });

        return BuildNode(0, "VS_VERSION_INFO", fixedInfo, false, new List<byte[]> { stringFileInfo, varFileInfo });
    }
}
"@

[PeResourceStamper]::StampIconAndVersion(
    $exeFull,
    $icoFull,
    $Version,
    $ProductName,
    $FileDescription,
    $CompanyName,
    $Copyright,
    $OriginalFilename
)

Write-Host "Stamped multi-LOD icon and PE version info onto $exeFull" -ForegroundColor Green
