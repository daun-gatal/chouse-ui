import { useQuery } from "@tanstack/react-query";
import { queryApi } from "@/api";

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const result = await queryApi.execute({
        query: "SELECT name FROM system.roles",
      });
      return result.data as { name: string }[];
    },
  });
}

export function useGrants() {
  return useQuery({
    queryKey: ["grants"],
    queryFn: async () => {
      const result = await queryApi.execute({
        query: "SELECT DISTINCT access_type FROM system.grants",
      });
      return result.data as { access_type: string }[];
    },
  });
}
