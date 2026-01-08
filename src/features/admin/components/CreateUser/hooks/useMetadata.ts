import { useQuery } from "@tanstack/react-query";
import { queryApi } from "@/api";

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const result = await queryApi.executeQuery<{ name: string }>(
        "SELECT name FROM system.roles"
      );
      return result.data;
    },
  });
}

export function useGrants() {
  return useQuery({
    queryKey: ["grants"],
    queryFn: async () => {
      const result = await queryApi.executeQuery<{ access_type: string }>(
        "SELECT DISTINCT access_type FROM system.grants"
      );
      return result.data;
    },
  });
}
