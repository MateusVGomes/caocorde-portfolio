using System.Runtime.InteropServices;

namespace Concorde.Captura;

/// <summary>
/// Número da saída DXGI de um monitor, para o ddagrab (modo jogo). O FFmpeg abre o Desktop Duplication na
/// primeira placa de vídeo e conta as saídas DELA — que não segue a ordem das telas do Windows
/// (ex.: "Tela 2" pode ser a saída 0). Acha pelo HMONITOR; null = o monitor está ligado em outra placa.
/// </summary>
public static class Dxgi
{
    public static int? SaidaDoMonitor(nint hmonitor)
    {
        try
        {
            var iid = typeof(IDXGIFactory1).GUID;
            if (CreateDXGIFactory1(ref iid, out var f) != 0) return null;
            var fabrica = (IDXGIFactory1)f;
            try
            {
                if (fabrica.EnumAdapters1(0, out var placa) != 0) return null;
                try
                {
                    for (uint i = 0; i < 16; i++)
                    {
                        if (placa.EnumOutputs(i, out var saida) != 0) break;
                        try
                        {
                            saida.GetDesc(out var d);
                            if (d.Monitor == hmonitor) return (int)i;
                        }
                        finally { Marshal.ReleaseComObject(saida); }
                    }
                }
                finally { Marshal.ReleaseComObject(placa); }
            }
            finally { Marshal.ReleaseComObject(fabrica); }
        }
        catch (Exception ex) { Console.WriteLine($"[vídeo] não consegui listar as saídas DXGI ({ex.Message})"); }
        return null;
    }

    [DllImport("dxgi.dll")] private static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object factory);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DXGI_OUTPUT_DESC
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        public int Left, Top, Right, Bottom;
        public int AttachedToDesktop;
        public int Rotation;
        public nint Monitor;
    }

    // Só os métodos usados, na ordem da vtable (IDXGIObject → IDXGIFactory → IDXGIFactory1 etc.).
    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIFactory1
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
        [PreserveSig] int EnumAdapters1(uint index, out IDXGIAdapter1 adapter);
    }

    [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIAdapter1
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        [PreserveSig] int EnumOutputs(uint index, out IDXGIOutput output);
    }

    [ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIOutput
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        void GetDesc(out DXGI_OUTPUT_DESC desc);
    }
}
